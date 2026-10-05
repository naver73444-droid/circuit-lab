import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Point this test at the untouched candidate to reproduce defects without patching it.
const base = process.env.CIRCUIT_REVIEW_ROOT ? pathToFileURL(resolve(process.env.CIRCUIT_REVIEW_ROOT) + "/") : new URL("../", import.meta.url);
const get = (name) => import(new URL(`src/${name}`, base));
const { simulateDC, simulateTransient, simulateACAtFrequency, parseValue } = await get("circuit-engine.js");
const { cloneExample } = await get("examples.js");
const { splitWireAtJunction, retargetWireProbes } = await get("circuit-edit.js");
const { projectSplitPoint } = await get("circuit-geometry.js");
const { acMagnitudeLevel, acPhaseDegrees } = await get("measurement-format.js");
const { buildResultsCSV, parseCSV } = await get("csv-format.js");
const { zoomAxis } = await get("scope-model.js");
const close = (actual, expected, abs = 1e-20, rel = 1e-8) => assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
const out = result => result.points[0].nodeVoltages[result.topology.nodeIdByPin["R2:0"]];

test("AUDIT-N01: an isolated drawing junction does not invalidate a valid divider", () => {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "floating-mark", x: 40, y: 40 }];
  const before = structuredClone(circuit), result = simulateDC(circuit);
  close(out(result), 5); assert.equal(result.topology.nodeIdByJunction["floating-mark"], undefined);
  assert.deepEqual(circuit, before);
});
test("AUDIT-N02: a wire-only drawing island creates no fictitious MNA unknown", () => {
  const { circuit } = cloneExample("divider");
  circuit.junctions = [{ id: "j1", x: 0, y: 0 }, { id: "j2", x: 40, y: 0 }];
  circuit.wires.push({ id: "loose", a: { junctionId: "j1" }, b: { junctionId: "j2" } });
  close(out(simulateDC(circuit)), 5);
});
test("AUDIT-N03: a split wire's b-anchored probe follows the b segment", () => {
  const { circuit } = cloneExample("divider");
  const wire = circuit.wires.find(w => w.id === "W2");
  const split = splitWireAtJunction(circuit, wire.id, { x: 0, y: 40 }, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  const probe = { key: "v", kind: "voltage", ...wire.b, wireId: wire.id };
  const retargeted = retargetWireProbes([probe], wire.id, split.replacementWireId, split)[0];
  assert.equal(retargeted.wireId, split.splitWireIds[1]);
  assert.equal(retargeted.componentId, wire.b.componentId);
});
test("AUDIT-N04: splitting at an endpoint reuses that endpoint, not a zero-length wire", () => {
  const { circuit } = cloneExample("divider");
  const split = splitWireAtJunction(circuit, "W2", { x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  assert.equal(split.unchanged, true); assert.equal(split.circuit.wires.length, circuit.wires.length);
  assert.deepEqual(split.endpoint, circuit.wires.find(w => w.id === "W2").a);
});
test("AUDIT-N05: degenerate wire geometry is explicitly rejected", () => {
  assert.throws(() => projectSplitPoint([], { x: 0, y: 0 }), RangeError);
  assert.throws(() => projectSplitPoint([{ x: 0, y: 0 }], { x: 0, y: 0 }), RangeError);
});
test("AUDIT-N06: uppercase exponent notation", () => { close(parseValue("1E-3"), .001); });
test("AUDIT-N07: both Unicode micro characters and existing units remain distinct", () => {
  close(parseValue("2.2μF"), 2.2e-6); close(parseValue("2.2µF"), 2.2e-6);
  assert.equal(parseValue("1M"), 1e6); assert.equal(parseValue("1m"), .001);
  assert.equal(parseValue("1F"), 1); assert.equal(parseValue("1f"), 1e-15);
});
function diodeCircuit(bias) {
  return { version: 1, components: [
    { id: "V1", type: "V", props: { dc: String(bias), mode: "DC", acMagnitude: "1", acPhase: "0" } },
    { id: "D1", type: "D", props: { is: "1e-12", n: "1" } }, { id: "G1", type: "GND" },
  ], wires: [
    { id: "w1", a: { componentId: "V1", pin: 0 }, b: { componentId: "D1", pin: 0 } },
    { id: "w2", a: { componentId: "V1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    { id: "w3", a: { componentId: "D1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
  ] };
}
for (const bias of [-.2, 0, .2]) test(`AUDIT-N08: AC diode conductance equals derivative of original model at ${bias} V`, () => {
  const current = simulateACAtFrequency(diodeCircuit(bias), 1000).points[0].componentCurrents.D1;
  const expected = 1e-12 / .02585 * Math.exp(bias / .02585);
  close(current.re, expected); close(current.im, 0);
});
test("AUDIT-N09: zero AC amplitude is minus infinity, not an artificial floor", () => {
  assert.equal(acMagnitudeLevel({ re: 0, im: 0 }, "V").value, -Infinity);
  assert.equal(acPhaseDegrees({ re: 0, im: 0 }), null);
});
test("AUDIT-N10: zero AC exports as -Infinity and an empty phase cell", () => {
  const result = { analysis: "ac", xValues: [1000] };
  const rows = parseCSV(buildResultsCSV(result, [{ probe: { kind: "voltage", label: "V0" }, raw: [{ re: 0, im: 0 }] }]));
  assert.deepEqual(rows[1], ["1000", "-Infinity", ""]);
});
test("AUDIT-N11: text CSV formula prefix is escaped without changing negative numeric samples", () => {
  const result = { analysis: "dc", xValues: [0] };
  const rows = parseCSV(buildResultsCSV(result, [{ probe: { kind: "current", label: "=2+2" }, raw: [-.001] }]));
  assert.equal(rows[0][1], "'=2+2_A"); assert.equal(rows[1][1], "-0.001");
});
test("AUDIT-N12: a coarse requested step still computes the actual end sample", () => {
  const { circuit } = cloneExample("divider");
  const result = simulateTransient(circuit, { start: 0, end: "1n", step: "100" });
  assert.deepEqual(result.xValues, [0, 1e-9]);
  assert.equal(result.points.length, 2); close(out(result), 5);
});
test("AUDIT-N13: large finite plotting data cannot cause an endless autoscale loop", () => {
  const url = new URL("src/scope-model.js", base).href;
  const execution = spawnSync(process.execPath, ["--input-type=module", "-e", `import { fittedAxis } from ${JSON.stringify(url)}; console.log(JSON.stringify(fittedAxis([-3.15e20,4.05e20])));`], { encoding: "utf8", timeout: 1200 });
  assert.equal(execution.error?.code, undefined, "autoscale process exceeded 1200 ms");
  assert.equal(execution.status, 0, execution.stderr);
  const axis = JSON.parse(execution.stdout); assert.ok(axis.minimum <= -3.15e20 && axis.maximum >= 4.05e20);
});
test("AUDIT-N14: zoom clamps its anchor consistently outside the plotting rectangle", () => {
  const axis = { minimum: 0, maximum: 8, division: 1, automatic: true };
  assert.deepEqual(zoomAxis(axis, 1, -2), zoomAxis(axis, 1, 0));
  assert.deepEqual(zoomAxis(axis, 1, 3), zoomAxis(axis, 1, 1));
});
