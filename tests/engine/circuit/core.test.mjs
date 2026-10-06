import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeIdealVoltageConstraints, CircuitError, buildTopology, parseValue, simulateAC, simulateACAtFrequency, simulateDC, simulateTransient, validateCircuitStructure } from "../../../src/circuit-engine.js";
import { cloneExample } from "../../../src/examples.js";
import { acMagnitudeLevel } from "../../../src/plot-format.js";
import { deserializeProject, serializeProject } from "../../../src/project-format.js";
import { buildResultsCSV } from "../../../src/csv-format.js";
import { parseCSV } from "../../helpers/csv.mjs";
import { divideComplex, phasorPolar, theoreticalImpedance, wrapPhaseDifference } from "../../../src/phasor-format.js";
import { phasorFromPolar } from "../../helpers/complex.mjs";
import { UnionFind } from "../../../src/union-find.js";

describe("basic analyses", () => {
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
});

describe("numeric edge cases", () => {
  const close = (actual, expected, abs = 1e-20, rel = 1e-8) => assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);

  const out = result => result.points[0].nodeVoltages[result.topology.nodeIdByPin["R2:0"]];

  test("an isolated drawing junction does not invalidate a valid divider", () => {
    const { circuit } = cloneExample("divider");
    circuit.junctions = [{ id: "floating-mark", x: 40, y: 40 }];
    const before = structuredClone(circuit), result = simulateDC(circuit);
    close(out(result), 5); assert.equal(result.topology.nodeIdByJunction["floating-mark"], undefined);
    assert.deepEqual(circuit, before);
  });

  test("a wire-only drawing island creates no fictitious MNA unknown", () => {
    const { circuit } = cloneExample("divider");
    circuit.junctions = [{ id: "j1", x: 0, y: 0 }, { id: "j2", x: 40, y: 0 }];
    circuit.wires.push({ id: "loose", a: { junctionId: "j1" }, b: { junctionId: "j2" } });
    close(out(simulateDC(circuit)), 5);
  });

  test("uppercase exponent notation", () => { close(parseValue("1E-3"), .001); });

  test("both Unicode micro characters and existing units remain distinct", () => {
    close(parseValue("2.2μF"), 2.2e-6); close(parseValue("2.2µF"), 2.2e-6);
    assert.equal(parseValue("1M"), 1e6); assert.equal(parseValue("1m"), .001);
    assert.equal(parseValue("1F"), 1); assert.equal(parseValue("1f"), 1e-15);
  });

  function diodeCircuit(bias) {
    return { version: 1, components: [
      { id: "V1", type: "V", props: { dc: String(bias), mode: "DC", acMagnitude: "1", acPhase: "0" } },
      { id: "D1", type: "D", props: { is: "1e-12", n: "1" } }, { id: "G1", type: "GND" },
    ], wires: [
      { id: "w1", a: { componentId: "V1", pin: 0 }, b: { componentId: "D1", pin: 0 } },
      { id: "w2", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      { id: "w3", a: { componentId: "D1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ] };
  }

  for (const bias of [-.2, 0, .2]) test(`AC diode conductance equals derivative of original model at ${bias} V`, () => {
    const current = simulateACAtFrequency(diodeCircuit(bias), 1000).points[0].componentCurrents.D1;
    const expected = 1e-12 / .02585 * Math.exp(bias / .02585);
    close(current.re, expected); close(current.im, 0);
  });

  test("a coarse requested step still computes the actual end sample", () => {
    const { circuit } = cloneExample("divider");
    const result = simulateTransient(circuit, { start: 0, end: "1n", step: "100" });
    assert.deepEqual(result.xValues, [0, 1e-9]);
    assert.equal(result.points.length, 2); close(out(result), 5);
  });
});

test("oversized drawings have an explicit structural limit", () => {
  const circuit = { version: 1, components: Array.from({ length: 257 }, (_, i) => ({ id: `R${i}`, type: "R", props: { value: "1k" } })), wires: [] };
  assert.throws(() => validateCircuitStructure(circuit), e => e.code === "CIRCUIT_TOO_LARGE");
});

test("many parallel resistors remain usable when the matrix is small", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const r = circuit.components.find(c => c.type === "R");
  for (let i = 0; i < 50; i++) {
    const id = `extra${i}`; circuit.components.push({ id, type: "R", props: { value: "1k" } });
    circuit.wires.push({ id: `exA${i}`, a: { componentId: id, pin: 0 }, b: { componentId: r.id, pin: 0 } });
    circuit.wires.push({ id: `exB${i}`, a: { componentId: id, pin: 1 }, b: { componentId: "G1", pin: 0 } });
  }
  // Existing parallel resistors add no nodes, so this intentionally small topology must remain usable.
  assert.ok(simulateAC(circuit, { startFrequency: 10, endFrequency: 100, pointsPerDecade: 2 }).points.length > 0);
});

test("large solve workload is rejected before entering the frequency loop", () => {
  const components = [{ id: "V", type: "V", props: { dc: "1", mode: "DC", acMagnitude: "1" } }, { id: "G", type: "GND" }];
  const wires = [{ id: "ground", a: { componentId: "V", pin: 1 }, b: { componentId: "G", pin: 0 } }];
  let previous = { componentId: "V", pin: 0 };
  for (let i = 0; i < 50; i++) {
    const id = `R${i}`; components.push({ id, type: "R", props: { value: "1k" } });
    wires.push({ id: `w${i}`, a: previous, b: { componentId: id, pin: 0 } }); previous = { componentId: id, pin: 1 };
  }
  wires.push({ id: "return", a: previous, b: { componentId: "G", pin: 0 } });
  assert.throws(() => simulateAC({ version: 1, components, wires }, { startFrequency: 1, endFrequency: 1e21, pointsPerDecade: 200 }), e => e.code === "ANALYSIS_BUDGET");
});

test('AC points/decade rejects zero and fractions instead of a one-point false sweep',()=>{
  const c=cloneExample('rc-lowpass').circuit;
  for(const value of [0,.1,.49,1.5,-1])assert.throws(()=>simulateAC(c,{pointsPerDecade:value}));
});

test('AC total sample limit rejects huge frequency ranges',()=>{
  assert.throws(()=>simulateAC(cloneExample('rc-lowpass').circuit,{startFrequency:'1e-100',endFrequency:'1e100',pointsPerDecade:200}),e=>e.code==='TOO_MANY_POINTS');
});

test('magic component types are rejected as unknown',()=>{
  const c=cloneExample('divider').circuit;c.components[0].type='constructor';assert.throws(()=>validateCircuitStructure(c),e=>e.code==='UNKNOWN_COMPONENT');
});

test('a nonfinite placement coordinate is rejected on import',()=>{
  const c=cloneExample('divider').circuit;c.components[0].x='bad';assert.throws(()=>validateCircuitStructure(c));
});

test('shared disjoint sets joins paths and rejects missing nodes',()=>{
  const u=new UnionFind(['a','b','c']);u.union('a','b');u.union('b','c');assert.equal(u.find('a'),u.find('c'));assert.throws(()=>u.find('unknown'));
});

describe("time grid and value parsing", () => {
  const close = (actual, expected, abs, rel) => {
    assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
  };

  function seriesCircuit(kind) {
    const load = kind === "R"
      ? { id: "R1", type: "R", props: { ref: "R1", value: "1k" } }
      : { id: "R1", type: "R", props: { ref: "R1", value: "1" } };
    const storage = kind === "RC"
      ? { id: "C1", type: "C", props: { ref: "C1", value: "1", ic: "0" } }
      : kind === "RL"
        ? { id: "L1", type: "L", props: { ref: "L1", value: "1", ic: "0" } }
        : null;
    const components = [
      { id: "V1", type: "V", props: { ref: "V1", mode: "DC", dc: "1" } },
      load,
      ...(storage ? [storage] : []),
      { id: "G1", type: "GND", props: { ref: "GND" } },
    ];
    const wires = [
      { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "R1", pin: 0 } },
      storage
        ? { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: storage.id, pin: 0 } }
        : { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
      ...(storage ? [{ id: "W3", a: { componentId: storage.id, pin: 1 }, b: { componentId: "G1", pin: 0 } }] : []),
      { id: "WG", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ];
    return { version: 1, components, wires };
  }

  const pointVoltage = (result, pointIndex, componentId, pin = 0) => {
    const node = result.topology.nodeIdByPin[`${componentId}:${pin}`];
    return result.points[pointIndex].nodeVoltages[node];
  };

  const expectCode = (action, code) => assert.throws(action, (error) => error instanceof CircuitError && error.code === code);

  test("A: transient reaches the parsed end with actual adjacent dt", () => {
    const tinyEnd = 1.00000000005;
    const resistor = simulateTransient(seriesCircuit("R"), { start: 0, step: 1, end: tinyEnd });
    assert.equal(resistor.xValues[0], 0);
    assert.equal(resistor.xValues.at(-1), tinyEnd);
    assert.ok(resistor.xValues.every((time, index, values) => index === 0 || time > values[index - 1]));
    resistor.points.forEach((point) => close(point.componentCurrents.R1, .001, 0, 2 * Number.EPSILON));

    for (const kind of ["RC", "RL"]) {
      const result = simulateTransient(seriesCircuit(kind), { start: 0, step: 1, end: tinyEnd });
      const q = result.xValues.slice(1).reduce((value, time, index) => value / (1 + time - result.xValues[index]), 1);
      const actual = kind === "RC"
        ? pointVoltage(result, result.points.length - 1, "C1")
        : result.points.at(-1).componentCurrents.L1;
      close(actual, 1 - q, 2e-15, 2e-15);
    }

    const rc = simulateTransient(seriesCircuit("RC"), { start: 0, step: 1, end: 1.5 });
    const rl = simulateTransient(seriesCircuit("RL"), { start: 0, step: 1, end: 1.5 });
    assert.deepEqual(rc.xValues, [0, 1, 1.5]);
    assert.deepEqual(rl.xValues, [0, 1, 1.5]);
    close(pointVoltage(rc, 2, "C1"), 2 / 3, 1e-12, 1e-12);
    close(rc.points[2].componentCurrents.C1, 1 / 3, 1e-12, 1e-12);
    close(rl.points[2].componentCurrents.L1, 2 / 3, 1e-12, 1e-12);
    close(pointVoltage(rl, 2, "L1"), 1 / 3, 1e-12, 1e-12);

    const ulp = 2 ** -52;
    const oneUlp = simulateTransient(seriesCircuit("R"), { start: 1, step: ulp, end: 1 + ulp });
    assert.deepEqual(oneUlp.xValues, [1, 1 + ulp]);
    expectCode(() => simulateTransient(seriesCircuit("R"), { start: 1, step: 2 ** -54, end: 1 + 2 ** -51 }), "NUMERIC_FAILURE");
    expectCode(() => simulateTransient(seriesCircuit("R"), { start: 0, step: 1, end: 20000.5 }), "TOO_MANY_POINTS");
  });

  test("B: decimal and SI exponents combine before binary64 conversion", () => {
    for (const sign of [1, -1]) {
      const tiny = parseValue(`${sign < 0 ? "-" : ""}1e-330T`);
      const tinyExpected = sign * Number("1e-318");
      assert.notEqual(tiny, 0);
      assert.equal(Math.sign(tiny), sign);
      close(tiny, tinyExpected, Number.MIN_VALUE, 0);

      const large = parseValue(`${sign < 0 ? "-" : ""}1e310p`);
      close(large, sign * 1e298, 0, 2 * Number.EPSILON);
    }
    for (const value of ["1e-324", "-1e-324", "1e309"]) expectCode(() => parseValue(value), "INVALID_VALUE");
    assert.equal(parseValue("5e-324"), Number.MIN_VALUE);
    assert.equal(parseValue("0e999T"), 0);
    assert.ok(Object.is(parseValue("-0e999T"), -0));
    assert.equal(parseValue(0), 0);
    assert.ok(Object.is(parseValue(-0), -0));

    const existing = [["1M", 1e6], ["1meg", 1e6], ["1m", 1e-3], ["1F", 1], ["1f", 1e-15], ["1μF", 1e-6], ["-2.5kV", -2500]];
    for (const [input, expected] of existing) close(parseValue(input), expected, 0, 2 * Number.EPSILON);
    for (const value of ["", "1foo", NaN, Infinity]) expectCode(() => parseValue(value), "INVALID_VALUE");
  });
});

describe("project boundaries", () => {
  const readFixture = (name) => readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");

  const f0Text = readFixture("project-divider-f0.json");

  const f0 = deserializeProject(f0Text);

  const VABS = 1e-9, VREL = 1e-8, IABS = 1e-11, IREL = 1e-8;

  const close = (actual, expected, abs = VABS, rel = VREL) => {
    assert.ok(Number.isFinite(actual));
    assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
  };

  const cclose = (actual, expected) => { close(actual.re, expected.re); close(actual.im, expected.im); };

  const node = (result, point, id, pin) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  function seriesFor(result, probes) {
    return probes.map((probe) => {
      const raw = probe.kind === "voltage"
        ? result.points.map((point) => node(result, point, probe.componentId, probe.pin))
        : result.points.map((point) => point.componentCurrents[probe.componentId]);
      return { probe, raw };
    });
  }

  test("F0 divider: DC, transient and AC match the hand-computed values", () => {
    const dc = simulateDC(f0.circuit), point = dc.points[0];
    close(node(dc, point, "R2", 0), 2.5);
    close(point.componentCurrents.R1, 0.0025, IABS, IREL);
    close(point.componentCurrents.R2, 0.0025, IABS, IREL);
    close(point.componentCurrents.V1, -0.0025, IABS, IREL);
    const csv = parseCSV(buildResultsCSV(dc, seriesFor(dc, f0.probes)));
    assert.equal(csv.length, 2);
    // Independent expectation (5 V across 1 k + 1 k): operating_point, V(n) = 2.5 V, I(R2) = 2.5 mA, V(V1+) = 5 V.
    assert.deepEqual(csv[0], ["operating_point", "V(n)_V", "I(R2, 1→2)_A", "V(V1+)_V"]);
    assert.deepEqual(csv[1], ["0", "2.5", "0.0025", "5"]);

    const transient = simulateTransient(f0.circuit, { start: 0, end: "20u", step: "10u" });
    assert.deepEqual(transient.xValues, [0, 1e-5, 2e-5]);
    for (const sample of transient.points) {
      close(node(transient, sample, "R2", 0), 2.5);
      close(sample.componentCurrents.R2, 0.0025, IABS, IREL);
    }

    const ac = simulateACAtFrequency(f0.circuit, 1);
    cclose(node(ac, ac.points[0], "R2", 0), { re: 0.5, im: 0 });
    cclose(ac.points[0].componentCurrents.R2, { re: 0.0005, im: 0 });
    // Same sign convention as the DC check above: the source current is negative while it delivers power (1 V / 2 k = 0.5 mA).
    cclose(ac.points[0].componentCurrents.V1, { re: -0.0005, im: 0 });
  });

  test("explicit 2k recovery computes the new result, not the old 1k result", () => {
    const project = deserializeProject(f0Text);
    project.circuit.components.find((component) => component.id === "R1").props.value = "2k";
    const result = simulateDC(project.circuit), point = result.points[0];
    close(node(result, point, "R2", 0), 5 / 3);
    close(point.componentCurrents.R2, 1 / 600, IABS, IREL);
    close(point.componentCurrents.V1, -1 / 600, IABS, IREL);
  });
});
