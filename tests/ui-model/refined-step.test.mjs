import test from "node:test";
import assert from "node:assert/strict";
import { fastestTimeConstant, refinedTransientStep } from "../../src/analysis-policy.js";
import { componentDefaults, simulate } from "../../src/circuit-engine.js";

const part = (id, type, props, nets = []) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets });
function make(specs) {
  const all = [...specs, part("GND", "GND", {}, ["0"])];
  const groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: component.id, pin }); }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 3, geometryVersion: 2, components: all.map(({ nets, ...component }) => component), wires, junctions: [] };
}
// Lab circuit: 1.5 kΩ · 47 nF (τ = 70.5 µs) driven by a 0–5 V, 1 kHz square wave.
const lab = () => make([
  part("V1", "V", { mode: "PULSE", pulseV1: "0", pulseV2: "5", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "500u", pulsePeriod: "1m" }, ["in", "0"]),
  part("R1", "R", { value: "1.5k" }, ["in", "out"]), part("C1", "C", { value: "47n", ic: "0" }, ["out", "0"]),
]);
const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-9;

test("fastestTimeConstant: R·C, L/R and √(LC) of the parts", () => {
  assert.ok(near(fastestTimeConstant(lab()), 70.5e-6));
  assert.equal(fastestTimeConstant({ components: [part("R1", "R", { value: "1k" })] }), 0, "no energy storage");
  assert.ok(Math.abs(fastestTimeConstant({ components: [part("R1", "R", { value: "100" }), part("L1", "L", { value: "10m" }), part("C1", "C", { value: "1u" })] }) - 1e-4) < 1e-12);
});

test("refinedTransientStep: 10 µs on τ = 70.5 µs runs at 2 µs; a fine step, a long window or no τ stays", () => {
  const refined = refinedTransientStep(lab(), { start: "0", end: "5m", step: "10u" });
  assert.equal(refined.step, 2e-6);
  assert.ok(near(refined.tau, 70.5e-6));
  assert.equal(refinedTransientStep(lab(), { start: "0", end: "5m", step: "5u" }), null, "14 samples per τ is enough");
  assert.equal(refinedTransientStep(lab(), { start: "0", end: "5m", step: "abc" }), null);
  const long = refinedTransientStep(lab(), { start: "0", end: "1", step: "100u" });
  assert.ok(long && long.step > 2e-6 && 1 / long.step <= 20000, "never past the 20 000-point limit");
});

test("the refined step shows the charging peak 5 V / 1.5 kΩ = 3.33 mA (the first sample after the edge is the highest one drawn)", () => {
  const run = (step) => simulate(lab(), { analysis: "transient", start: "0", end: "1m", step });
  const peak = (result) => Math.max(...result.points.map((point) => point.componentCurrents.R1));
  const exact = 5 / 1.5e3;
  assert.ok(peak(run("10u")) < exact * 0.9, "10 µs: the drawn peak is more than 10 % low");
  assert.ok(peak(run(String(refinedTransientStep(lab(), { start: "0", end: "1m", step: "10u" }).step))) > exact * 0.96, "2 µs: within 4 %");
});
