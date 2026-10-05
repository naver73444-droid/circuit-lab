import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloneSelectedComponent } from "../src/circuit-edit.js";
import { localPin, pinPosition } from "../src/circuit-geometry.js";
import { classifyCircuitConnections } from "../src/circuit-status.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";
import { controlledSourceInputModel, sourceInlineDescriptor } from "../src/ui-model.js";

const project = {
  title: "VCVS/VCCS",
  subtitle: "CIRCUIT-014",
  circuit: {
    version: 2, geometryVersion: 2, junctions: [],
    components: [
      { id: "E1", type: "VCVS", x: 200, y: 200, rotation: 90, props: { ref: "E1", g: "4" } },
      { id: "G1", type: "VCCS", x: 400, y: 200, rotation: 0, props: { ref: "G1", gm: "3mS" } },
      { id: "GND", type: "GND", x: 300, y: 400, rotation: 0, props: { ref: "GND" } },
    ],
    wires: [
      { id: "W1", a: { componentId: "E1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W2", a: { componentId: "E1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
      { id: "W3", a: { componentId: "G1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
      { id: "W4", a: { componentId: "G1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
    ],
  },
  settings: { analysis: "dc" },
  probes: [
    { key: "V:E1:0", kind: "voltage", componentId: "E1", pin: 0, label: "V(E1.p)", color: "#80bfff" },
    { key: "I:G1", kind: "current", componentId: "G1", label: "I(G1,p→n)", color: "#f5bc79" },
  ],
};

test("CIRCUIT-014 four-pin geometry reuses exact rotation transform", () => {
  assert.deepEqual([0, 1, 2, 3].map((pin) => localPin("VCVS", pin)), [{ x: -40, y: 0 }, { x: 40, y: 0 }, { x: 0, y: -40 }, { x: 0, y: 40 }]);
  const component = project.circuit.components[0];
  assert.deepEqual(pinPosition(component, 0), { x: 200, y: 160 });
  assert.deepEqual(pinPosition(component, 2), { x: 240, y: 200 });
});

test("CIRCUIT-014 project v2 preserves controlled props and probe references", () => {
  const text = serializeProject(project); assert.equal(JSON.parse(text).version, 2);
  const restored = deserializeProject(text); assert.equal(restored.circuit.version, 2);
  assert.deepEqual(restored.circuit.components.find((item) => item.id === "E1").props, { ref: "E1", g: "4" });
  assert.deepEqual(restored.probes, project.probes);
  const legacy = structuredClone(project); legacy.circuit.components = legacy.circuit.components.filter((item) => item.type === "GND"); legacy.circuit.wires = []; legacy.probes = [];
  assert.equal(JSON.parse(serializeProject(legacy)).version, 1);
  const disguised = JSON.parse(text); disguised.version = 1;
  assert.throws(() => deserializeProject(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE");
});

test("CIRCUIT-014 inline units, draft classification and clone props are type-specific", () => {
  assert.deepEqual(sourceInlineDescriptor(project.circuit.components[0], "dc"), { prop: "g", label: "전압 이득", unit: "V/V", value: "4" });
  assert.deepEqual(sourceInlineDescriptor(project.circuit.components[1], "ac"), { prop: "gm", label: "상호컨덕턴스", unit: "S", value: "3mS" });
  assert.equal(controlledSourceInputModel("VCVS", "-2").status, "valid");
  assert.equal(controlledSourceInputModel("VCVS", "1V").status, "invalid");
  assert.equal(controlledSourceInputModel("VCCS", "20µS").status, "valid");
  assert.equal(controlledSourceInputModel("VCCS", "20s").status, "invalid");
  const clone = cloneSelectedComponent(project.circuit, "E1");
  assert.equal(clone.type, "VCVS"); assert.deepEqual(clone.props, { ref: "E1", g: "4" }); assert.notEqual(clone.id, "E1");
});

test("CIRCUIT-014 connection status never joins control pins to output pins", () => {
  const result = classifyCircuitConnections(project.circuit, "dc");
  assert.deepEqual(result.byComponent.E1.floatingPins.sort(), [3]);
  assert.deepEqual(result.byComponent.G1.floatingPins.sort(), [1, 3]);
});

test("CIRCUIT-014 app adds only bounded palette/symbol/inspector/probe paths", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  for (const expected of ["전압 제어 전압원", "전압 제어 전류원", "전압 이득 g (V/V)", "상호컨덕턴스 gm (S)", "pin 1→2 출력 전류"]) assert.ok(source.includes(expected));
  assert.match(source, /component\.type === "VCVS" \|\| component\.type === "VCCS"/);
});
