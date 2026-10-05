import test from "node:test";
import assert from "node:assert/strict";
import { cloneComponentSet, cloneSelectedComponent, deleteComponentFromCircuit } from "../src/circuit-edit.js";
import { deserializeCircuit, serializeCircuit, simulateDC } from "../src/circuit-engine.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";

const circuit = {
  version: 3, geometryVersion: 2, junctions: [],
  components: [
    { id: "V1", type: "V", x: 80, y: 100, rotation: 0, props: { ref: "supply", mode: "DC", dc: "1", acMagnitude: "0", acPhase: "0" } },
    { id: "S1", type: "CURRENT_SENSOR", x: 200, y: 100, rotation: 0, props: { ref: "sense" } },
    { id: "F1", type: "CCCS", x: 320, y: 100, rotation: 0, props: { ref: "F1", beta: "2" }, control: { kind: "branchCurrent", elementId: "S1", direction: 1 } },
    { id: "GND", type: "GND", x: 200, y: 240, rotation: 0, props: { ref: "GND" } },
  ],
  wires: [
    { id: "W1", a: { componentId: "V1", pin: 0 }, b: { componentId: "S1", pin: 0 } },
    { id: "W2", a: { componentId: "V1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
    { id: "W3", a: { componentId: "S1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
    { id: "W4", a: { componentId: "F1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
  ],
};

test("CIRCUIT-015 v3 preserves permanent control IDs and lower-version disguises fail", () => {
  const raw = serializeCircuit(circuit); assert.equal(JSON.parse(raw).version, 3);
  assert.deepEqual(deserializeCircuit(raw).components.find((item) => item.id === "F1").control, circuit.components[2].control);
  const project = { title: "v3", subtitle: "control", circuit, settings: { analysis: "dc" }, probes: [{ key: "I:S1", kind: "current", componentId: "S1", label: "I(sense)", color: "#80bfff" }] };
  const text = serializeProject(project); assert.equal(JSON.parse(text).version, 3);
  assert.deepEqual(deserializeProject(text).probes, project.probes);
  for (const version of [1, 2]) { const disguised = JSON.parse(raw); disguised.version = version; assert.throws(() => deserializeCircuit(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE"); }
});

test("CIRCUIT-015 missing, wrong-type and invalid-direction controls fail without substitution", () => {
  for (const control of [
    { kind: "branchCurrent", elementId: "MISSING", direction: 1 },
    { kind: "branchCurrent", elementId: "GND", direction: 1 },
    { kind: "branchCurrent", elementId: "S1", direction: 0 },
    { kind: "branchCurrent", elementId: "S1", direction: 2 },
  ]) {
    const copy = structuredClone(circuit); copy.components.find((item) => item.id === "F1").control = control;
    assert.throws(() => simulateDC(copy), (error) => ["MISSING_CONTROL", "INVALID_CONTROL"].includes(error.code));
    assert.throws(() => serializeCircuit(copy), (error) => ["MISSING_CONTROL", "INVALID_CONTROL"].includes(error.code));
  }
});

test("CIRCUIT-015 beta/rm dimensions reject foreign units and accept zero/negative", () => {
  for (const [type, prop, good, bad] of [
    ["CCCS", "beta", ["0", "-2", "1k"], ["1A", "2S"]],
    ["CCVS", "rm", ["0", "-2k", "2kΩ", "2kohm"], ["1V", "2S"]],
  ]) for (const value of [...good, ...bad]) {
    const copy = structuredClone(circuit), component = copy.components.find((item) => item.id === "F1");
    component.type = type; component.props = { ref: type, [prop]: value };
    const action = () => serializeCircuit(copy);
    if (good.includes(value)) assert.doesNotThrow(action); else assert.throws(action, (error) => error.code === "INVALID_VALUE");
  }
});

test("CIRCUIT-015 set clone remaps internal control and internal wires while single clone keeps external ID", () => {
  const connected = structuredClone(circuit);
  connected.wires.push({ id: "WINTERNAL", a: { componentId: "S1", pin: 0 }, b: { componentId: "F1", pin: 0 } });
  const group = cloneComponentSet(connected, ["S1", "F1"]);
  const clonedSensor = group.components.find((item) => item.type === "CURRENT_SENSOR");
  const clonedDependent = group.components.find((item) => item.type === "CCCS");
  assert.equal(clonedDependent.control.elementId, clonedSensor.id);
  assert.equal(group.wires.length, 1);
  assert.deepEqual([group.wires[0].a.componentId, group.wires[0].b.componentId], [clonedSensor.id, clonedDependent.id]);
  assert.equal(circuit.components.find((item) => item.id === "F1").control.elementId, "S1");
  const single = cloneSelectedComponent(circuit, "F1");
  assert.equal(single.control.elementId, "S1");
});

test("CIRCUIT-015 target deletion preserves dangling ID and blocks run/save", () => {
  const deleted = deleteComponentFromCircuit(circuit, "S1").circuit;
  assert.equal(deleted.components.find((item) => item.id === "F1").control.elementId, "S1");
  assert.throws(() => simulateDC(deleted), (error) => error.code === "MISSING_CONTROL");
  assert.throws(() => serializeCircuit(deleted), (error) => error.code === "MISSING_CONTROL");
});
