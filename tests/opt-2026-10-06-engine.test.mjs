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

// Hybrid singular-pivot rule: singular only if the pivot is below the old absolute
// 1e-14 AND negligible relative to its original column. Columns holding +-1 coupling
// entries or huge gains must keep solving exactly as the absolute rule did.
const floatingSource = (resistance, acMagnitude) => circuit(
  [component("V1", "V", acMagnitude ? { mode: "DC", dc: "0", acMagnitude } : { mode: "DC", dc: "5" }), component("R1", "R", { value: resistance }), component("R2", "R", { value: resistance }), component("G1", "GND")],
  [wire("a", "V1", 0, "R1", 0), wire("b", "V1", 1, "R2", 0), wire("c", "R1", 1, "G1", 0), wire("d", "R2", 1, "G1", 0)],
);
const opampFollower = (gain, load, acMagnitude) => circuit(
  [component("V1", "V", acMagnitude ? { mode: "DC", dc: "0", acMagnitude } : { mode: "DC", dc: "1" }), component("U1", "OPAMP", { gain }), component("RL", "R", { value: load }), component("G1", "GND")],
  [wire("a", "V1", 0, "U1", 0), wire("b", "V1", 1, "G1", 0), wire("c", "U1", 1, "U1", 2), wire("d", "U1", 2, "RL", 0), wire("e", "RL", 1, "G1", 0)],
);
const mixedDivider = (r1, r2) => circuit(
  [component("V1", "V", { mode: "DC", dc: "10" }), component("R1", "R", { value: r1 }), component("R2", "R", { value: r2 }), component("G1", "GND")],
  [wire("a", "V1", 0, "R1", 0), wire("b", "R1", 1, "R2", 0), wire("c", "R2", 1, "G1", 0), wire("d", "V1", 1, "G1", 0)],
);
const singular = (action, label) => assert.throws(action, (e) => e instanceof CircuitError && e.code === "SINGULAR", label);

test("hybrid pivot rule: floating DC source between two high-resistance nodes solves like the baseline", () => {
  for (const resistance of ["1e9", "1e12", "1e13"]) {
    const nodes = simulateDC(floatingSource(resistance)).points[0].nodeVoltages;
    near(nodes[1], 2.5, `floating +node R=${resistance}`, 1e-9);
    near(nodes[2], -2.5, `floating -node R=${resistance}`, 1e-9);
  }
  singular(() => simulateDC(floatingSource("1e15")), "R=1e15 floating source stays SINGULAR (as in the baseline)");
  const ac = simulateACAtFrequency(floatingSource("1e12", "5"), "1k").points[0];
  near(ac.nodeVoltages[1].re, 2.5, "AC floating +node", 1e-9);
  near(ac.nodeVoltages[2].re, -2.5, "AC floating -node", 1e-9);
});

test("hybrid pivot rule: op-amp followers with huge open-loop gain solve like the baseline", () => {
  for (const gain of ["1e9", "1e12", "1e15"]) {
    for (const load of ["1k", "1e9"]) {
      const out = simulateDC(opampFollower(gain, load)).points[0].nodeVoltages[2];
      near(out, 1 - 1 / (1 + Number(gain)), `follower gain=${gain} RL=${load}`, 1e-9);
    }
  }
  const ac = simulateACAtFrequency(opampFollower("1e12", "1k", "1"), "1k").points[0];
  near(ac.nodeVoltages[2].re, 1, "AC follower gain 1e12", 1e-9);
});

test("hybrid pivot rule: huge VCVS gain and a 1e15 grounded divider solve", () => {
  const vcvs = circuit(
    [component("V1", "V", { mode: "DC", dc: "1e-9" }), component("E1", "VCVS", { g: "1e12" }), component("RL", "R", { value: "1k" }), component("G1", "GND")],
    [wire("a", "V1", 0, "E1", 2), wire("b", "V1", 1, "G1", 0), wire("c", "E1", 3, "G1", 0), wire("d", "E1", 0, "RL", 0), wire("e", "E1", 1, "G1", 0), wire("f", "RL", 1, "G1", 0)],
  );
  near(simulateDC(vcvs).points[0].nodeVoltages[2], 1000, "VCVS gain 1e12", 1e-9);
  const high = simulateDC(mixedDivider("1e15", "1e15")).points[0].nodeVoltages;
  near(high[2], 5, "1e15/1e15 divider", 1e-9);
});

test("hybrid pivot rule: mixed-scale resistor pairs match the baseline engine values", () => {
  const cases = [["1u", "10meg", 10], ["1n", "1e9", 10], ["1u", "1e12", 10], ["1m", "1e12", 10], ["10meg", "1u", 1e-12], ["1e-6", "1e15", 10], ["1", "1e14", 10]];
  for (const [r1, r2, expected] of cases) near(simulateDC(mixedDivider(r1, r2)).points[0].nodeVoltages[2], expected, `${r1}/${r2}`, 1e-9);
});

test("hybrid pivot rule: truly singular and contradictory circuits are still rejected", () => {
  singular(() => simulateDC(circuit([component("I1", "I", { mode: "DC", dc: "1m" }), component("R1", "R", { value: "1k" }), component("G1", "GND")], [wire("a", "I1", 0, "R1", 0), wire("b", "R1", 1, "G1", 0)])), "current source into floating node");
  singular(() => simulateDC(circuit([component("I1", "I", { mode: "DC", dc: "1m" }), component("G1", "GND")], [wire("a", "I1", 0, "G1", 0)])), "current source with an open terminal");
  singular(() => simulateDC(circuit([component("I1", "I", { mode: "DC", dc: "1m" }), component("I2", "I", { mode: "DC", dc: "1m" }), component("G1", "GND")], [wire("a", "I1", 0, "G1", 0), wire("b", "I1", 1, "I2", 0), wire("c", "I2", 1, "G1", 0)])), "current sources only");
  singular(() => simulateDC(circuit([component("V1", "V", { mode: "DC", dc: "5" }), component("C1", "C", { value: "1u" }), component("C2", "C", { value: "1u" }), component("G1", "GND")], [wire("a", "V1", 0, "C1", 0), wire("b", "C1", 1, "C2", 0), wire("c", "C2", 1, "G1", 0), wire("d", "V1", 1, "G1", 0)])), "series capacitors at DC");
  singular(() => simulateDC(circuit([component("U1", "OPAMP", { gain: "100k" }), component("R1", "R", { value: "1k" }), component("G1", "GND")], [wire("a", "U1", 2, "R1", 0), wire("b", "R1", 1, "G1", 0)])), "floating op-amp");
  singular(() => simulateDC(circuit([component("U1", "OPAMP_IDEAL", {}), component("R1", "R", { value: "1k" }), component("G1", "GND")], [wire("a", "U1", 2, "R1", 0), wire("b", "R1", 1, "G1", 0)])), "floating ideal op-amp");
  const parallel = (a, b) => circuit([component("V1", "V", { mode: "DC", dc: a }), component("V2", "V", { mode: "DC", dc: b }), component("R1", "R", { value: "1k" }), component("G1", "GND")], [wire("a", "V1", 0, "R1", 0), wire("b", "V2", 0, "R1", 0), wire("c", "V1", 1, "G1", 0), wire("d", "V2", 1, "G1", 0), wire("e", "R1", 1, "G1", 0)]);
  assert.throws(() => simulateDC(parallel("5", "3")), (e) => e instanceof CircuitError && e.code === "IDEAL_CONSTRAINT_CONFLICT", "parallel sources with different values");
  assert.throws(() => simulateDC(parallel("5", "5")), (e) => e instanceof CircuitError && e.code === "IDEAL_CONSTRAINT_REDUNDANCY", "parallel sources with the same value");
  assert.throws(() => simulateDC(circuit([component("V1", "V", { mode: "DC", dc: "5" }), component("G1", "GND")], [wire("a", "V1", 0, "G1", 0), wire("b", "V1", 1, "G1", 0)])), (e) => e instanceof CircuitError && e.code === "VOLTAGE_SOURCE_SHORT", "shorted voltage source");
  const acParallel = circuit(parallel("0", "0").components.map((c) => (c.type === "V" ? { ...c, props: { ...c.props, acMagnitude: c.id === "V1" ? "1" : "2" } } : c)), parallel("0", "0").wires);
  singular(() => simulateACAtFrequency(acParallel, "1k"), "parallel AC sources");
});
