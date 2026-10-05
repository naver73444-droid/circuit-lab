import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults } from "../src/circuit-engine.js";
import { analyzeDCPort } from "../src/port-analysis.js";

const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });
function make(specs) {
  const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])], groups = new Map(), wires = [];
  const components = all.map(({ nets, ...component }) => component);
  all.forEach((component) => component.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: component.id, pin }); }));
  for (const endpoints of groups.values()) for (let i = 1; i < endpoints.length; i += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[i] });
  return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
}
const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);
const source = (id, type, dc, nets) => item(id, type, { ...componentDefaults(type), ref: id, dc }, nets);
const code = (expected) => (error) => error?.code === expected;

test("CIRCUIT-016 rejects same/missing endpoints, nonlinear circuits and invalid load boundaries", () => {
  const circuit = make([source("V1", "V", "5", ["a", "0"]), resistor("R1", "1k", ["a", "p"]), resistor("RL", "1k", ["p", "0"])]);
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 0 }, externalLoadIds: ["RL"] }), code("PORT_SAME_NET"));
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "missing", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: [] }), code("PORT_ENDPOINT_MISSING"));
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: ["R1"] }), code("PORT_LOAD_BOUNDARY"));
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: ["absent"] }), code("PORT_LOAD_MISSING"));
  const diode = make([item("D1", "D", { ref: "D1", is: "1e-12", n: "1" }, ["p", "0"])]);
  assert.throws(() => analyzeDCPort(diode, { p: { componentId: "D1", pin: 0 }, n: { componentId: "D1", pin: 1 }, externalLoadIds: [] }), code("PORT_NONLINEAR_UNSUPPORTED"));
});

test("CIRCUIT-016 rejects removal of a referenced control branch and preserves input on failure", () => {
  const circuit = make([
    item("S1", "CURRENT_SENSOR", { ref: "S1" }, ["p", "0"]),
    item("F1", "CCCS", { ref: "F1", beta: "0" }, ["p", "0"], { kind: "branchCurrent", elementId: "S1", direction: 1 }),
    resistor("R1", "1k", ["p", "0"]),
  ]);
  const before = JSON.stringify(circuit);
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "S1", pin: 0 }, n: { componentId: "S1", pin: 1 }, externalLoadIds: ["S1"] }), code("PORT_LOAD_IS_CONTROL"));
  assert.equal(JSON.stringify(circuit), before);
});

test("CIRCUIT-016 accepts a multi-component load with only p/n boundary and rejects a third boundary", () => {
  const twoBoundary = make([
    source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
    resistor("RL1", "1k", ["p", "x"]), resistor("RL2", "1k", ["x", "0"]),
  ]);
  const request = { p: { componentId: "RL1", pin: 0 }, n: { componentId: "RL2", pin: 1 }, externalLoadIds: ["RL1", "RL2"] };
  const result = analyzeDCPort(twoBoundary, request);
  assert.ok(Math.abs(result.equivalent.vth.value - 8) < 1e-9);

  const thirdBoundary = make([
    source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
    resistor("KEEP", "9k", ["x", "0"]), resistor("RL1", "1k", ["p", "x"]), resistor("RL2", "1k", ["x", "0"]),
  ]);
  assert.throws(() => analyzeDCPort(thirdBoundary, request), code("PORT_LOAD_BOUNDARY"));
});

test("CIRCUIT-016 keeps unrelated ideal-branch nonuniqueness explicit", () => {
  const circuit = make([
    source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
    source("VX1", "V", "0", ["x", "0"]), source("VX2", "V", "0", ["x", "0"]),
  ]);
  assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "R2", pin: 0 }, n: { componentId: "R2", pin: 1 }, externalLoadIds: [] }), code("PORT_RTH_UNRESOLVED"));
});
