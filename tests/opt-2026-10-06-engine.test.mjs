import assert from "node:assert/strict";
import test from "node:test";
import { CircuitError, parseValue, simulate, simulateAC, simulateACAtFrequency, simulateDC, simulateTransient } from "../src/circuit-engine.js";
import { cloneExample } from "../src/examples.js";

const component = (id, type, props = {}) => ({ id, type, x: 0, y: 0, rotation: 0, props: { ref: id, ...props } });
const wire = (id, a, pinA, b, pinB) => ({ id, a: { componentId: a, pin: pinA }, b: { componentId: b, pin: pinB } });
const circuit = (components, wires) => ({ version: 1, geometryVersion: 2, components, wires, junctions: [] });
const near = (actual, expected, label, relative = 1e-12, absolute = 1e-300) => {
  assert.ok(Math.abs(actual - expected) <= Math.max(Math.abs(expected) * relative, absolute), `${label}: ${actual} vs ${expected}`);
};

test("parseValue cache returns identical values on repeated parses", () => {
  for (const [text, expected] of [["1k", 1000], ["100n", 1e-7], ["2.2meg", 2.2e6], ["10Ω", 10], ["4.7µF", 4.7e-6], ["  5  ", 5], ["-3m", -3e-3], ["0", 0]]) {
    const first = parseValue(text);
    const second = parseValue(text);
    const third = parseValue(text, "다른 라벨");
    assert.equal(first, expected, text);
    assert.equal(second, first);
    assert.equal(third, first);
  }
  assert.equal(parseValue(2.5), 2.5);
  assert.throws(() => parseValue(Number.NaN, "숫자"), (e) => e instanceof CircuitError && e.code === "INVALID_VALUE" && e.message.includes("숫자"));
});

test("parseValue cache never hides failures and keeps the caller's label", () => {
  assert.equal(parseValue("1k", "R1"), 1000);
  for (const label of ["A 라벨", "B 라벨"]) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.throws(() => parseValue("1kx", label), (e) => e instanceof CircuitError && e.code === "INVALID_VALUE" && e.message.includes(label));
      assert.throws(() => parseValue("abc", label), (e) => e.code === "INVALID_VALUE" && e.message.includes(label));
    }
  }
  assert.equal(parseValue("1k", "R1"), 1000);
});

test("parseValue cache survives overflow of its bound", () => {
  for (let index = 0; index < 3000; index += 1) assert.equal(parseValue(`${index}u`), Number(`${index}e-6`));
  assert.equal(parseValue("1k"), 1000);
  assert.equal(parseValue("5"), 5);
});

const divider = (resistance) => circuit(
  [component("V1", "V", { mode: "DC", dc: "10" }), component("R1", "R", { value: resistance }), component("R2", "R", { value: resistance }), component("G1", "GND")],
  [wire("a", "V1", 0, "R1", 0), wire("b", "R1", 1, "R2", 0), wire("c", "R2", 1, "G1", 0), wire("d", "V1", 1, "G1", 0)],
);

test("scale-aware pivots solve extreme-resistance dividers", () => {
  for (const resistance of ["1k", "1e12", "1e15", "1e18"]) {
    const result = simulateDC(divider(resistance));
    near(result.points[0].nodeVoltages[2], 5, `divider ${resistance}`, 1e-9);
    near(result.points[0].nodeVoltages[1], 10, `divider ${resistance} top`, 1e-12);
  }
  const current = simulateDC(divider("1e15")).points[0].componentCurrents.R1;
  near(current, 5e-15, "1e15 divider current", 1e-9);
});

test("floating nodes and contradictory ideal sources still raise SINGULAR", () => {
  // The only element at the ungrounded-by-DC node is a current source: no unique voltage.
  const floating = circuit(
    [component("I1", "I", { mode: "DC", dc: "1m" }), component("G1", "GND")],
    [wire("W1", "I1", 1, "G1", 0)],
  );
  const parallel = circuit(
    [component("V1", "V", { mode: "DC", dc: "10" }), component("V2", "V", { mode: "DC", dc: "5" }), component("G1", "GND")],
    [wire("a", "V1", 0, "V2", 0), wire("b", "V1", 1, "G1", 0), wire("c", "V2", 1, "G1", 0)],
  );
  assert.throws(() => simulateDC(floating), (e) => e instanceof CircuitError && e.code === "SINGULAR", "floating DC");
  // A contradictory ideal-source pair is refined from SINGULAR into a named conflict.
  assert.throws(() => simulateDC(parallel), (e) => e instanceof CircuitError && ["SINGULAR", "IDEAL_CONSTRAINT_CONFLICT"].includes(e.code), "parallel sources DC");
  const acParallel = circuit(parallel.components.map((c) => (c.type === "V" ? { ...c, props: { ...c.props, acMagnitude: "1" } } : c)), parallel.wires);
  assert.throws(() => simulateACAtFrequency(acParallel, "1k"), (e) => e instanceof CircuitError && e.code === "SINGULAR", "parallel sources AC");
});

// Reference values were produced by the baseline engine (commit c1b3c44) before the
// parse/lookup/pivot optimizations; the optimized engine must reproduce them.
const runExample = (id) => {
  const example = cloneExample(id);
  return simulate(example.circuit, example.settings);
};

test("RC transient example matches baseline reference values", () => {
  const result = runExample("rc-charge");
  assert.equal(result.points.length, 501);
  near(result.points[250].nodeVoltages[2], 4.584446869182488, "rc node 2 @2.5ms");
  near(result.points[500].nodeVoltages[2], 4.965463119093544, "rc node 2 @5ms");
  near(result.points[500].componentCurrents.R1, 0.000034536880906456344, "rc R1 @5ms");
});

test("RLC and RL transient examples match baseline reference values", () => {
  const rlc = runExample("rlc");
  assert.equal(rlc.points.length, 1001);
  near(rlc.points[500].nodeVoltages[2], 1.086088044013918, "rlc n2 @0.5ms");
  near(rlc.points[500].nodeVoltages[3], 1.074909451792539, "rlc n3 @0.5ms");
  near(rlc.points[1000].nodeVoltages[3], 1.001799725354283, "rlc n3 @1ms");
  near(rlc.points[1000].componentCurrents.L1, 0.00005486465043806861, "rlc L1 @1ms");
  const rl = runExample("rl");
  near(rl.points[250].nodeVoltages[2], 0.08311062616350284, "rl n2 @250us");
  near(rl.points[500].componentCurrents.L1, 0.009930926238187091, "rl L1 @500us");
});

test("diode transient example matches baseline reference values", () => {
  const diode = runExample("diode");
  assert.equal(diode.points.length, 668);
  near(diode.points[667].nodeVoltages[1], 0.012566357385010074, "diode source @end");
  near(diode.points[667].nodeVoltages[2], 6.260048384679101e-10, "diode load @end");
  near(diode.points[333].nodeVoltages[2], -7.033814420896555e-10, "diode load @mid");
});

test("RC low-pass AC example matches baseline reference values", () => {
  const ac = runExample("rc-lowpass");
  assert.equal(ac.points.length, 121);
  near(ac.points[60].nodeVoltages[2].re, 0.024704523031857648, "ac re @1k");
  near(ac.points[60].nodeVoltages[2].im, -0.15522309613464766, "ac im @1k");
  near(ac.points[120].nodeVoltages[2].im, -0.0015915453994873614, "ac im @100k");
});

test("repeated simulations of the same circuit are stable (no stale per-simulation caches)", () => {
  const example = cloneExample("rc-charge");
  const first = simulate(example.circuit, example.settings);
  const second = simulate(example.circuit, example.settings);
  assert.deepEqual(second.points[250], first.points[250]);
  const changed = structuredClone(example.circuit);
  changed.components.find((c) => c.type === "R").props.value = "2k";
  const third = simulate(changed, example.settings);
  assert.notEqual(third.points[250].nodeVoltages[2], first.points[250].nodeVoltages[2]);
  const ac = simulateAC(divider("1k"), { startFrequency: "10", endFrequency: "1k", pointsPerDecade: "5" });
  assert.ok(ac.points.length > 0);
});
