import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localPin, pinPosition } from "../src/circuit-geometry.js";
import { controlReferenceModel, controlledSourceInputModel, sourceInlineDescriptor } from "../src/ui-model.js";

test("CIRCUIT-015 coefficient inputs and inline descriptors are dimension-specific", () => {
  assert.equal(controlledSourceInputModel("CCCS", "-2").status, "valid");
  assert.equal(controlledSourceInputModel("CCCS", "1A").status, "invalid");
  assert.equal(controlledSourceInputModel("CCVS", "2kΩ").status, "valid");
  assert.equal(controlledSourceInputModel("CCVS", "2S").status, "invalid");
  assert.deepEqual(sourceInlineDescriptor({ type: "CCCS", props: { beta: "3" } }, "dc"), { prop: "beta", label: "전류 이득", unit: "A/A", value: "3" });
  assert.deepEqual(sourceInlineDescriptor({ type: "CCVS", props: { rm: "2k" } }, "ac"), { prop: "rm", label: "전달저항", unit: "Ω", value: "2k" });
});

test("CIRCUIT-015 reference model lists only V/sensor and preserves missing IDs", () => {
  const circuit = { components: [
    { id: "V1", type: "V", props: { ref: "renamed" } }, { id: "S1", type: "CURRENT_SENSOR", props: { ref: "sense" } },
    { id: "R1", type: "R", props: { ref: "R1" } },
  ] };
  const valid = controlReferenceModel(circuit, { type: "CCCS", control: { kind: "branchCurrent", elementId: "S1", direction: 1 } });
  assert.equal(valid.status, "valid"); assert.deepEqual(valid.targets.map((item) => item.id), ["V1", "S1"]);
  const missing = controlReferenceModel(circuit, { type: "CCVS", control: { kind: "branchCurrent", elementId: "gone", direction: -1 } });
  assert.equal(missing.status, "missing"); assert.match(missing.reason, /gone/);
});

test("CIRCUIT-015 new two-pin geometry reuses the existing rotation equation", () => {
  for (const type of ["CURRENT_SENSOR", "CCCS", "CCVS"]) for (const version of [1, 2]) {
    assert.deepEqual([localPin(type, 0, version), localPin(type, 1, version)], [{ x: -40, y: 0 }, { x: 40, y: 0 }]);
    assert.deepEqual(pinPosition({ type, x: 100, y: 120, rotation: 90 }, 0, version), { x: 100, y: 80 });
  }
});

test("CIRCUIT-015 app exposes palette, target/direction, atomic Shift clone and save blocking", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  for (const text of ["0 V 전류 센서", "전류 제어 전류원", "전류 제어 전압원", "data-control-target", "data-control-direction", "Shift+복제", "저장 차단"]) assert.ok(source.includes(text), text);
  assert.match(source, /cloneComponentSet\(state\.circuit, ids\)/);
  assert.match(source, /event\?\.shiftKey/);
  assert.match(source, /serializeProject[\s\S]*catch \(error\)/);
});
