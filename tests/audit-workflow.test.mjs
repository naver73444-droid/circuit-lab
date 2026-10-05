import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputDrafts } from "../src/input-drafts.js";
import { hexRgb, contrastingTrace, contrastRatio } from "../src/color-model.js";
import { fittedAxis } from "../src/scope-model.js";
import { simulateAC, validateCircuitStructure } from "../src/circuit-engine.js";
import { cloneExample } from "../src/examples.js";

test("AUDIT-W01: drafts retain identity and invalid strings across selection changes", () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "R1", "value", "1e", "1k");
  drafts.set("prop", "R2", "value", "banana", "1k");
  assert.equal(drafts.get("prop", "R1", "value"), "1e");
  assert.equal(drafts.size, 2); drafts.delete("prop", "R2", "value");
  assert.equal(drafts.size, 1); assert.equal(drafts.get("prop", "R1", "value"), "1e");
});
test("AUDIT-W02: draft key construction has no separator collision", () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "a:b", "c", "first", ""); drafts.set("prop", "a", "b:c", "second", "");
  assert.equal(drafts.get("prop", "a:b", "c"), "first");
  assert.equal(drafts.get("prop", "a", "b:c"), "second");
});
test("AUDIT-W03: removed components discard only their drafts", () => {
  const drafts = new InputDrafts(); drafts.set("prop", "R1", "value", "bad", "1k");
  drafts.set("setting", "", "step", "1e", "1u"); drafts.retainComponents(new Set());
  assert.equal(drafts.size, 1); assert.equal(drafts.get("setting", "", "step"), "1e");
  drafts.set("setting", "", "step", "1u", "1u"); assert.equal(drafts.size, 0);
});
test("AUDIT-W04: waveform colors meet 4.5:1 against each supported canvas", () => {
  for (const dark of [true, false]) for (const input of ["#176baf", "#b85d0b", "#fff", "#000", "#333333", "#ff0000", "#80bfff", "#f5bc79"]) {
    const output = contrastingTrace(input, dark);
    assert.ok(contrastRatio(hexRgb(output), dark ? [24, 27, 32] : [244, 245, 248]) >= 4.5, `${input} -> ${output}`);
  }
});
test("AUDIT-W05: unsupported display extremes reject explicitly", () => {
  assert.throws(() => fittedAxis([1e301]), RangeError);
  assert.throws(() => fittedAxis([1e-301]), RangeError);
  assert.ok(Number.isFinite(fittedAxis([0, 1e-25]).division));
});
test("AUDIT-W06: oversized drawings have an explicit structural limit", () => {
  const circuit = { version: 1, components: Array.from({ length: 257 }, (_, i) => ({ id: `R${i}`, type: "R", props: { value: "1k" } })), wires: [] };
  assert.throws(() => validateCircuitStructure(circuit), e => e.code === "CIRCUIT_TOO_LARGE");
});
test("AUDIT-W07: many parallel resistors remain usable when the matrix is small", () => {
  const { circuit } = cloneExample("rc-lowpass");
  const r = circuit.components.find(c => c.type === "R");
  for (let i = 0; i < 50; i++) {
    const id = `extra${i}`; circuit.components.push({ id, type: "R", props: { value: "1k" } });
    circuit.wires.push({ id: `exA${i}`, a: { componentId: id, pin: 0 }, b: { componentId: r.id, pin: 0 } });
    circuit.wires.push({ id: `exB${i}`, a: { componentId: id, pin: 1 }, b: { componentId: "G1", pin: 0 } });
  }
  // Existing parallel resistors add no nodes, so this intentionally small topology must remain usable.
  assert.ok(simulateAC(circuit, { startFrequency: 10, endFrequency: 100, pointsPerDecade: 2 }).points.length > 0);
});
test("AUDIT-W08: major dark text tokens meet contrast targets", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8").split(':root[data-theme="light"]')[0];
  const token = name => hexRgb(new RegExp(`--${name}: (#[a-f0-9]+)`).exec(css)[1]);
  assert.ok(contrastRatio(token("text"), token("panel")) >= 7);
  assert.ok(contrastRatio(token("muted"), token("panel")) >= 4.5);
  assert.ok(contrastRatio([255, 255, 255], token("action")) >= 4.5);
});

test("AUDIT-W09: large solve workload is rejected before entering the frequency loop", () => {
  const components = [{ id: "V", type: "V", props: { dc: "1", mode: "DC", acMagnitude: "1" } }, { id: "G", type: "GND" }];
  const wires = [{ id: "ground", a: { componentId: "V", pin: 1 }, b: { componentId: "G", pin: 0 } }];
  let previous = { componentId: "V", pin: 0 };
  for (let i = 0; i < 50; i++) {
    const id = `R${i}`; components.push({ id, type: "R", props: { value: "1k" } });
    wires.push({ id: `w${i}`, a: previous, b: { componentId: id, pin: 0 } }); previous = { componentId: id, pin: 1 };
  }
  wires.push({ id: "return", a: previous, b: { componentId: "G", pin: 0 } });
  assert.throws(() => simulateAC({ version: 1, components, wires }, { startFrequency: 1, endFrequency: 1e21, pointsPerDecade: 200 }), e => e.code === "ANALYSIS_BUDGET");
});
