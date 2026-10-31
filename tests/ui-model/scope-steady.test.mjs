import test from "node:test";
import assert from "node:assert/strict";
import { generatorTimebase, steadyStateRun, triggeredResult } from "../../src/analysis-policy.js";
import { componentDefaults, simulate } from "../../src/circuit-engine.js";
import { analysisCircuit } from "../../src/source-model.js";

const part = (id, type, props, nets = []) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets });
function make(specs) {
  const all = [...specs, part("GND", "GND", {}, ["0"])];
  const groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: component.id, pin }); }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 3, geometryVersion: 2, components: all.map(({ nets, ...component }) => component), wires, junctions: [] };
}
const square = { mode: "PULSE", pulseV1: "0", pulseV2: "5", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "500u", pulsePeriod: "1m" };
const rc = (r, c, source = square) => make([part("V1", "V", source, ["in", "0"]), part("R1", "R", { value: r }, ["in", "out"]), part("C1", "C", { value: c, ic: "0" }, ["out", "0"])]);
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const settings = { analysis: "transient", start: "0", end: "5m", step: "2u" };

test("정상상태: RC 1 kΩ·1 µF with a 0–5 V 1 kHz square settles by 5τ = 5 ms; from that rising edge it swings 1.888…3.112 V", () => {
  const circuit = rc("1k", "1u");
  const plan = steadyStateRun(circuit, settings);
  near(plan.trigger, 5e-3, 1e-12, "trigger = first edge at or after 5 ms");
  near(plan.end, 10e-3, 1e-12, "the 5 ms window after it");
  assert.equal(plan.source, "V1");
  const result = triggeredResult(simulate(analysisCircuit(circuit).circuit, { ...settings, end: String(plan.end), step: String(plan.step) }), plan.trigger);
  assert.equal(result.xValues[0], 0, "t = 0 is the trigger sample");
  near(result.xValues.at(-1), 5e-3, 1e-9, "window kept");
  const v = result.points.map((point) => point.nodeVoltages[2]);
  const vmax = 5 / (1 + Math.exp(-0.5)), vmin = 5 - vmax;
  near(Math.max(...v), vmax, 0.01, "Vmax = 5/(1+e^−0.5)");
  near(Math.min(...v), vmin, 0.01, "Vmin");
  near(v[0], vmin, 0.02, "at the rising edge the capacitor is at its minimum");
});

test("정상상태: a lab RC (1.5 kΩ·47 nF) needs only one period; a sine triggers at its upward zero crossing; DC and AC runs have none", () => {
  near(steadyStateRun(rc("1.5k", "47n"), settings).trigger, 1e-3, 1e-12, "settle 0.35 ms → the edge at 1 ms (at least one period)");
  const cosine = { mode: "SIN", amplitude: "1", frequency: "1k", offset: "0", phase: "90" };
  const plan = steadyStateRun(rc("1.5k", "47n", cosine), settings);
  near(plan.trigger, 1.75e-3, 1e-12, "cos(2πft) rises through 0 at 3T/4 (+ whole periods)");
  assert.equal(steadyStateRun(rc("1.5k", "47n", { mode: "DC", dc: "5" }), settings), null);
  assert.equal(steadyStateRun(rc("1.5k", "47n"), { ...settings, analysis: "ac" }), null);
  const long = steadyStateRun(rc("1k", "1"), settings);
  assert.ok(long.end / long.step <= 20000 + 1e-6, "never past the 20 000-point limit");
  assert.ok(Math.abs(long.trigger / long.step - Math.round(long.trigger / long.step)) < 1e-6, "the trigger is a whole number of steps");
});

test("Autoset: five periods at about 200 samples per period", () => {
  assert.deepEqual(generatorTimebase(1000), { end: "0.005", step: "0.000005" });
  assert.deepEqual(generatorTimebase(60), { end: "0.0833333", step: "0.00005" });
  assert.equal(generatorTimebase(0), null);
});
