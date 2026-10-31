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

test("정상상태: RC 1 kΩ·1 µF with a 0–5 V 1 kHz square settles by 10RC = 10 ms; from that rising edge it swings 1.888…3.112 V", () => {
  const circuit = rc("1k", "1u");
  const plan = steadyStateRun(circuit, settings);
  near(plan.trigger, 10e-3, 1e-12, "trigger = first edge at or after 10 ms");
  near(plan.end, 15e-3, 1e-12, "the 5 ms window after it");
  assert.equal(plan.source, "V1");
  const result = triggeredResult(simulate(analysisCircuit(circuit).circuit, { ...settings, end: String(plan.end), step: String(plan.step) }), plan.trigger);
  assert.equal(result.xValues[0], 0, "t = 0 is the trigger sample");
  near(result.xValues.at(-1), 5e-3, 1e-9, "window kept");
  const v = result.points.map((point) => point.nodeVoltages[2]);
  const vmax = 5 / (1 + Math.exp(-0.5)), vmin = 5 - vmax;
  // The engine's backward Euler at 2 µs = τ/500 lands within 0.6 % of the exact steady state (12 mV of 1.9 V).
  near(Math.max(...v), vmax, 0.012, "Vmax = 5/(1+e^−0.5)");
  near(Math.min(...v), vmin, 0.012, "Vmin");
  near(Math.max(...v) - Math.min(...v), vmax - vmin, 0.005, "Vpp");
  near(v[0], vmin, 0.03, "at the rising edge the capacitor is near its minimum (one step after it)");
});

test("정상상태: a lab RC needs only one period; a sine triggers at its upward zero crossing; a delayed square settles after it starts; refusals", () => {
  near(steadyStateRun(rc("1.5k", "47n"), settings).trigger, 1e-3, 1e-12, "settle 0.7 ms → the edge at 1 ms (at least one period)");
  const cosine = { mode: "SIN", amplitude: "1", frequency: "1k", offset: "0", phase: "90" };
  near(steadyStateRun(rc("1.5k", "47n", cosine), settings).trigger, 1.75e-3, 1e-12, "cos(2πft) rises through 0 at 3T/4 (+ whole periods)");
  near(steadyStateRun(rc("1k", "1u", { ...square, pulseDelay: "10m" }), settings).trigger, 20e-3, 1e-12, "delay 10 ms + settle 10 ms");
  assert.equal(steadyStateRun(rc("1.5k", "47n", { mode: "DC", dc: "5" }), settings), null);
  assert.equal(steadyStateRun(rc("1.5k", "47n"), { ...settings, analysis: "ac" }), null);
  assert.match(steadyStateRun(rc("10k", "100u"), settings).refused, /한 주기에 20점도 못 그립니다/, "a 10 s settle cannot be drawn at 1 kHz");
  // Long windows near the 20 000-point limit never pass it (the step is lengthened, not shortened, to put the trigger on a sample).
  for (const [end, step] of [["200m", "10u"], ["1", "50u"], ["500m", "100u"], ["20m", "1u"]]) {
    const plan = steadyStateRun(rc("1.5k", "47n"), { ...settings, end, step });
    if (plan.refused) continue;
    assert.ok(plan.end / plan.step <= 19990 + 1e-6, `${end}/${step}: ${plan.end / plan.step} points`);
    assert.ok(Math.abs(plan.trigger / plan.step - Math.round(plan.trigger / plan.step)) < 1e-6, `${end}/${step}: trigger on a sample`);
    simulate(analysisCircuit(rc("1.5k", "47n")).circuit, { ...settings, end: String(plan.end), step: String(plan.step) });
  }
});

test("Autoset: five periods at about 1000 samples per period", () => {
  assert.deepEqual(generatorTimebase(1000), { end: "0.005", step: "0.000001" });
  assert.deepEqual(generatorTimebase(60), { end: "0.0833333", step: "0.00001" });
  assert.equal(generatorTimebase(0), null);
});
