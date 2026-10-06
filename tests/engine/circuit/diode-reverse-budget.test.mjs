import assert from "node:assert/strict";
import test from "node:test";
import { CircuitError, simulate, simulateDC } from "../../../src/circuit-engine.js";
import { describeCircuitFailure } from "../../../src/analysis-diagnostics.js";

const component = (id, type, props = {}) => ({ id, type, x: 0, y: 0, rotation: 0, props: { ref: id, ...props } });
const wire = (id, a, pinA, b, pinB) => ({ id, a: { componentId: a, pin: pinA }, b: { componentId: b, pin: pinB } });
const circuit = (components, wires) => ({ version: 1, geometryVersion: 2, components, wires, junctions: [] });

const dcDiode = (volts) => circuit(
  [component("V1", "V", { mode: "DC", dc: String(volts) }), component("D1", "D", { is: "1e-12", n: "1" }), component("R1", "R", { value: "1k" }), component("G1", "GND")],
  [wire("W1", "V1", 0, "D1", 0), wire("W2", "D1", 1, "R1", 0), wire("W3", "R1", 1, "G1", 0), wire("W4", "V1", 1, "G1", 0)],
);

const rectifier = (amplitude) => circuit(
  [
    component("V1", "V", { mode: "SIN", offset: "0", amplitude: String(amplitude), frequency: "60", phase: "0", dc: "0" }),
    component("D1", "D", { is: "1e-12", n: "1" }),
    component("R1", "R", { value: "1k" }),
    component("C1", "C", { value: "10u" }),
    component("G1", "GND"),
  ],
  [wire("W1", "V1", 0, "D1", 0), wire("W2", "D1", 1, "R1", 0), wire("W3", "R1", 1, "G1", 0), wire("W4", "V1", 1, "G1", 0), wire("W5", "D1", 1, "C1", 0), wire("W6", "C1", 1, "G1", 0)],
);

test("diode reverse bias converges far beyond the old -5 V clamp", () => {
  for (const volts of [-5.4, -12, -100]) {
    const point = simulateDC(dcDiode(volts)).points[0];
    assert.equal(point.nodeVoltages[1], volts);
    // Reverse saturation current: the diode carries about -Is, the load sees about -1 nV.
    assert.ok(Math.abs(point.componentCurrents.D1 + 1e-12) < 1e-13, `D1 current @${volts}`);
    assert.ok(Math.abs(point.nodeVoltages[2]) < 2e-9, `load voltage @${volts}`);
  }
});

test("half-wave rectifier with RC filter converges for 12 V and 170 V amplitudes", () => {
  for (const amplitude of [6, 12, 170]) {
    const result = simulate(rectifier(amplitude), { analysis: "transient", start: "0", end: "50m", step: "50u" });
    assert.equal(result.points.length, 1001);
    const output = result.points.map((point) => point.nodeVoltages[2]);
    const peak = Math.max(...output);
    // The filter holds close to the peak minus one diode drop (< ~0.8 V model limit).
    assert.ok(peak > amplitude - 1 && peak <= amplitude, `peak ${peak} @${amplitude} V`);
    assert.ok(output.every(Number.isFinite));
  }
});

test("NO_CONVERGENCE hint does not blame the user's values", () => {
  const failure = describeCircuitFailure(circuit([], []), { analysis: "dc" }, new CircuitError("NO_CONVERGENCE", "수렴하지 않았습니다."));
  assert.match(failure.hint, /수치 한계/);
  assert.doesNotMatch(failure.hint, /값을 확인/);
});

// A ladder of n sections is 2n+... unknowns: R-C ladder gives n+1 nodes + source branch.
const ladder = (sections) => {
  const components = [component("V1", "V", { mode: "SIN", offset: "0", amplitude: "1", frequency: "1k", phase: "0", dc: "0" }), component("G1", "GND")];
  const wires = [wire("Wg", "V1", 1, "G1", 0)];
  let previous = ["V1", 0];
  for (let index = 1; index <= sections; index += 1) {
    components.push(component(`R${index}`, "R", { value: "1k" }), component(`C${index}`, "C", { value: "100n" }));
    wires.push(wire(`Wr${index}`, previous[0], previous[1], `R${index}`, 0), wire(`Wc${index}`, `R${index}`, 1, `C${index}`, 0), wire(`Wd${index}`, `C${index}`, 1, "G1", 0));
    previous = [`R${index}`, 1];
  }
  return circuit(components, wires);
};

test("analysis budget: a 62-unknown linear RC ladder with 1000 steps is allowed (LU is reused)", () => {
  const result = simulate(ladder(60), { analysis: "transient", start: "0", end: "10m", step: "10u" });
  assert.equal(result.points.length, 1001);
  assert.ok(result.points.at(-1).nodeVoltages[2] !== undefined);
});

test("analysis budget: pathological sizes are still rejected", () => {
  // 127 unknowns x 20001 points of substitution alone is far beyond the budget.
  assert.throws(() => simulate(ladder(125), { analysis: "transient", start: "0", end: "200m", step: "10u" }), (error) => error instanceof CircuitError && error.code === "ANALYSIS_BUDGET");
  // Nonlinear circuits refactor on every Newton iteration, so the same size is rejected much earlier.
  const nonlinear = ladder(40);
  nonlinear.components.push(component("D9", "D", { is: "1e-12", n: "1" }));
  nonlinear.wires.push(wire("Wd9a", "R40", 1, "D9", 0), wire("Wd9b", "D9", 1, "G1", 0));
  assert.throws(() => simulate(nonlinear, { analysis: "transient", start: "0", end: "20m", step: "10u" }), (error) => error instanceof CircuitError && error.code === "ANALYSIS_BUDGET");
});

test("wire ids reject reserved names like component and junction ids", () => {
  const bad = dcDiode(5);
  bad.wires[0].id = "__proto__";
  assert.throws(() => simulateDC(bad), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
});
