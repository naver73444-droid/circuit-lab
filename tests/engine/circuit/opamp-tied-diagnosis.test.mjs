import test from "node:test";
import assert from "node:assert/strict";
import { simulateDC, simulateTransient } from "../../../src/circuit-engine.js";

function makeCircuit(definition) {
  const components = definition.map(item => ({ id: item.id, type: item.type, props: { ref: item.id, ...item.props } }));
  components.push({ id: "G1", type: "GND", props: { ref: "GND" } });
  const nets = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
  for (const item of definition) item.nets.forEach((net, pin) => {
    if (!nets.has(net)) nets.set(net, []);
    nets.get(net).push({ componentId: item.id, pin });
  });
  const junctions = [...nets].map(([net], index) => ({ id: `J${index}`, x: index * 20, y: 0 }));
  const junctionByNet = new Map([...nets.keys()].map((net, index) => [net, junctions[index].id]));
  const wires = [];
  for (const [net, endpoints] of nets) for (const endpoint of endpoints) wires.push({ id: `W${wires.length + 1}`, a: endpoint, b: { junctionId: junctionByNet.get(net) } });
  return { version: 1, geometryVersion: 2, components, wires, junctions };
}

const tiedOpamp = { id: "U1", type: "OPAMP_IDEAL", props: {}, nets: ["0", "0", "out"] };
const cap = id => ({ id, type: "C", props: { value: "1u", ic: "1" }, nets: ["out", "0"] });

test("tied ideal op amp with two parallel same-IC capacitors blames the op amp, not the capacitors", () => {
  const circuit = makeCircuit([tiedOpamp, cap("C1"), cap("C2")]);
  assert.throws(() => simulateTransient(circuit, { end: "1m", step: "10u" }), (error) => {
    assert.equal(error.code, "IDEAL_OPAMP_INPUT_TIED");
    assert.match(error.message, /연산증폭기 U1/);
    assert.match(error.message, /op amp/);
    assert.equal(error.details.componentId, "U1");
    assert.equal(error.details.certainty, "confirmed");
    assert.ok(!/C1|C2/.test(error.message), "capacitors must not be blamed");
    return true;
  });
});

test("tied ideal op amp without any redundancy keeps the plain SINGULAR code", () => {
  const circuit = makeCircuit([tiedOpamp, { id: "R1", type: "R", props: { value: "1k" }, nets: ["out", "0"] }]);
  assert.throws(() => simulateDC(circuit), (error) => error.code === "SINGULAR");
  assert.throws(() => simulateTransient(circuit, { end: "1m", step: "10u" }), (error) => error.code === "SINGULAR");
});

test("a well-formed follower with parallel same-IC capacitors is not misdiagnosed", () => {
  const circuit = makeCircuit([
    { id: "V1", type: "V", props: { mode: "DC", dc: "1" }, nets: ["in", "0"] },
    { id: "U1", type: "OPAMP_IDEAL", props: {}, nets: ["in", "out", "out"] },
    { id: "RL", type: "R", props: { value: "1k" }, nets: ["out", "0"] },
  ]);
  assert.doesNotThrow(() => simulateTransient(circuit, { end: "1m", step: "100u" }));
});

test("duplicate ideal voltage sources are still reported as redundancy", () => {
  const circuit = makeCircuit([
    { id: "V1", type: "V", props: { mode: "DC", dc: "5" }, nets: ["a", "0"] },
    { id: "V2", type: "V", props: { mode: "DC", dc: "5" }, nets: ["a", "0"] },
  ]);
  assert.throws(() => simulateDC(circuit), (error) => error.code === "IDEAL_CONSTRAINT_REDUNDANCY");
});
