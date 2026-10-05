import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { circuitGeometryVersion, localPin, pinPosition } from "../src/circuit-geometry.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";
import { controlledSourceInputModel } from "../src/ui-model.js";

const expectedPins = [
  { x: -40, y: 0 },
  { x: 40, y: 0 },
  { x: 0, y: -40 },
  { x: 0, y: 40 },
];

function section(source, start, end) {
  return source.slice(source.indexOf(`function ${start}`), source.indexOf(`function ${end}`));
}

test("CIRCUIT-014 attempt-02 app commit paths use controlled coefficient validation before mutation", () => {
  assert.equal(controlledSourceInputModel("VCVS", "1V").status, "invalid");
  assert.equal(controlledSourceInputModel("VCCS", "3s").status, "invalid");
  assert.equal(controlledSourceInputModel("VCVS", "4").status, "valid");
  assert.equal(controlledSourceInputModel("VCCS", "3mS").status, "valid");

  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const pending = section(source, "commitPendingInputs", "snapshot");
  assert.match(pending, /controlledSourceInputModel\(update\.component\.type, update\.value\)/);
  assert.ok(pending.indexOf("controlledSourceInputModel") < pending.indexOf("update.object[update.key] = update.value"));
  assert.match(pending, /inputDrafts\.set\(update\.kind, update\.id, update\.key, update\.value, update\.object\[update\.key\]\)/);
  assert.match(pending, /return false;/);

  const inline = section(source, "closeInlineEditor", "addVoltageProbe");
  assert.match(inline, /controlledSourceInputModel\(component\.type, editor\.value\)/);
  assert.ok(inline.indexOf("controlledSourceInputModel") < inline.indexOf("component.props[edit.prop] = value"));
  assert.match(inline, /if \(classified\.status !== "valid"\)[\s\S]*return false;/);
});

test("CIRCUIT-014 attempt-02 corrected coefficients save and restore without changing values", () => {
  const project = {
    title: "attempt-02", subtitle: "controlled coefficients",
    circuit: {
      version: 2, geometryVersion: 1, wires: [], junctions: [],
      components: [
        { id: "E1", type: "VCVS", x: 100, y: 100, rotation: 0, props: { ref: "E1", g: "4" } },
        { id: "G1", type: "VCCS", x: 300, y: 100, rotation: 0, props: { ref: "G1", gm: "3mS" } },
      ],
    },
    settings: { analysis: "dc" }, probes: [],
  };
  const restored = deserializeProject(serializeProject(project));
  assert.equal(restored.circuit.components.find((item) => item.id === "E1").props.g, "4");
  assert.equal(restored.circuit.components.find((item) => item.id === "G1").props.gm, "3mS");
});

test("CIRCUIT-014 attempt-02 geometry1, omitted geometry and geometry2 keep four distinct controlled pins", () => {
  for (const type of ["VCVS", "VCCS"]) {
    for (const geometryVersion of [1, circuitGeometryVersion({}), 2]) {
      const pins = [0, 1, 2, 3].map((pin) => localPin(type, pin, geometryVersion));
      assert.deepEqual(pins, expectedPins);
      assert.equal(new Set(pins.map(({ x, y }) => `${x},${y}`)).size, 4);
    }
  }
});

test("CIRCUIT-014 attempt-02 controlled pin rotation matches the independent rotation equation", () => {
  for (const type of ["VCVS", "VCCS"]) for (const geometryVersion of [1, 2]) for (const rotation of [0, 90, 180, 270]) {
    const component = { type, x: 140, y: 220, rotation };
    const angle = rotation * Math.PI / 180;
    expectedPins.forEach((local, pin) => {
      const expected = {
        x: component.x + local.x * Math.cos(angle) - local.y * Math.sin(angle),
        y: component.y + local.x * Math.sin(angle) + local.y * Math.cos(angle),
      };
      const actual = pinPosition(component, pin, geometryVersion);
      assert.ok(Math.abs(actual.x - expected.x) <= 1e-9);
      assert.ok(Math.abs(actual.y - expected.y) <= 1e-9);
    });
  }
});

test("CIRCUIT-014 attempt-02 app routes hit pins through versioned geometry and keeps four-lead symbol", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const local = section(source, "localPin", "componentMarkup");
  assert.match(local, /geometryLocalPin\(type, pin, circuitGeometryVersion\(state\.circuit\)\)/);
  assert.match(source, /M-40 0H-24M24 0H40M0-40V-24M0 24V40/);
});
