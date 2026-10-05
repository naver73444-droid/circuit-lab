import test from "node:test";
import assert from "node:assert/strict";
import { CircuitError, parseValue, simulateTransient } from "../src/circuit-engine.js";

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

test("CIRCUIT-024 A: transient reaches the parsed end with actual adjacent dt", () => {
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

test("CIRCUIT-024 B: decimal and SI exponents combine before binary64 conversion", () => {
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
