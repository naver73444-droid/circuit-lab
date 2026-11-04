import test from "node:test";
import assert from "node:assert/strict";
import { generatorTimebase, refinedTransientStep, steadyStateRun, triggeredResult } from "../../src/analysis-policy.js";
import { componentDefaults, simulate } from "../../src/circuit-engine.js";
import { analysisCircuit } from "../../src/source-model.js";
import { examples } from "../../src/examples.js";

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
  assert.match(steadyStateRun(rc("10k", "100u"), settings).refused, /보수적 상한.*R·C를 줄이세요/, "the R·C bound is named as the cause");
  assert.match(steadyStateRun(rc("1.5k", "47n"), { ...settings, end: "1", step: "1u" }).refused, /보이는 구간 1 s가 길어.*구간을 줄이세요/, "a 1 s window at 1 kHz: the span is the cause");
  // 0.999 s alone fits (4.998e-5 ≤ 5e-5 s per point), but with the 1 ms trigger the run is 1 s: still the span, and there is one source,
  // so no "trigger period longer than the fastest" sentence.
  const oneSource = steadyStateRun(rc("1.5k", "47n"), { ...settings, end: "999m", step: "1u" }).refused;
  assert.match(oneSource, /보이는 구간 0.999 s가 길어.*구간을 줄이세요/);
  assert.doesNotMatch(oneSource, /트리거 전원 주기/);
  // The student's Δt alone: 100 µs > 1 ms/20 = 50 µs. The 5 ms span (run 6 ms = 0.3 µs per point) and R·C 0.705 ms are not the cause.
  const coarse = steadyStateRun(rc("1.5k", "47n"), { ...settings, step: "100u" }).refused;
  assert.match(coarse, /간격 Δt 0.0001 s가 가장 빠른 전원 주기의 1\/20\(0.00005 s\)보다 길어.*Δt를 0.00005 s 이하로 줄이세요/);
  assert.doesNotMatch(coarse, /구간을 줄이세요|R·C|트리거 전원 주기/);
  // RC 10k·10µ (1 s bound) with the same Δt: still Δt first, since a shorter settle would not help it.
  assert.match(steadyStateRun(rc("10k", "10u"), { ...settings, step: "100u" }).refused, /간격 Δt 0.0001 s/);
  // One source delayed 1 s: trigger = 1 + 1 ms (one period after the start), run 1.006 s → Δt ≥ 1.006/19990 ≈ 50.3 µs > 50 µs.
  // Without the delay the run (5 + 2 ms at most) fits, so the delay is named; one source, so never the "trigger period" sentence.
  const delayed = steadyStateRun(rc("1.5k", "47n", { ...square, pulseDelay: "1" }), settings).refused;
  assert.match(delayed, /구형 지연 1 s 뒤에야 트리거해.*지연을 줄이거나 정상상태를 끄세요/);
  assert.doesNotMatch(delayed, /트리거 전원 주기|구간을 줄이세요/);
  // A 0 Vpp sine or a square with equal levels is a DC level: nothing to trigger on.
  assert.equal(steadyStateRun(rc("1.5k", "47n", { mode: "SIN", amplitude: "0", frequency: "1k", offset: "5" }), settings), null);
  assert.equal(steadyStateRun(rc("1.5k", "47n", { ...square, pulseV1: "5" }), settings), null);
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

test("정상상태: 1 kΩ 10개 직렬과 1 µF는 τ=10 ms이므로 100 ms 뒤부터 표시한다", () => {
  const resistors = Array.from({ length: 10 }, (_, i) => part(`R${i + 1}`, "R", { value: "1k" }, [i ? `n${i}` : "in", i === 9 ? "out" : `n${i + 1}`]));
  const circuit = make([part("V1", "V", square, ["in", "0"]), ...resistors, part("C1", "C", { value: "1u", ic: "0" }, ["out", "0"])]);
  const plan = steadyStateRun(circuit, settings);
  // Rseries=10×1k, τ=10k×1u=10 ms; 10τ=100 ms is exactly a rising edge of the 1 ms square.
  assert.ok(plan && !plan.refused);
  near(plan.trigger, 0.1, 1e-12, "10τ");
  assert.ok(plan.end / plan.step <= 19990 + 1e-6);
  const result = triggeredResult(simulate(analysisCircuit(circuit).circuit, { ...settings, start: "0", end: String(plan.end), step: String(plan.step) }), plan.trigger);
  const node = result.topology.nodeIdByPin["C1:0"];
  const v = result.points.map((point) => point.nodeVoltages[node]);
  // In steady state Vmax=5/(1+e^(−T/2τ))=2.5625 V, Vmin=2.4375 V, and mean=2.5 V.
  const vmax = 5 / (1 + Math.exp(-0.05)), vmin = 5 - vmax;
  near(Math.max(...v), vmax, 0.005, "steady Vmax");
  near(Math.min(...v), vmin, 0.005, "steady Vmin");
  near(v.reduce((a, b) => a + b, 0) / v.length, 2.5, 0.01, "settled average");
  near(v.at(-1), v[0], 0.002, "the capacitor no longer drifts over five periods");
});

test("정상상태: 1 kΩ 10개 병렬과 1 H의 RL 정착 상한은 10·ΣL·Σ(1/R)이다", () => {
  const circuit = make([part("V1", "V", square, ["in", "0"]), part("L1", "L", { value: "1" }, ["in", "out"]),
    ...Array.from({ length: 10 }, (_, i) => part(`R${i + 1}`, "R", { value: "1k" }, ["out", "0"]))]);
  // Rparallel=100 Ω, τ=1 H/100 Ω=10 ms; 10τ=100 ms (L/Rmin alone would give 10 ms).
  const plan = steadyStateRun(circuit, settings);
  assert.ok(plan && !plan.refused);
  near(plan.trigger, 0.1, 1e-12, "RL settling bound");
});

test("정상상태: 첫 SIN 1 Hz 뒤의 10 kHz 전원도 주기당 20점 미만이면 거절한다", () => {
  for (const type of ["V", "I"]) for (const mode of ["SIN", "PULSE"]) {
    const circuit = make([part("V1", "V", { mode: "SIN", frequency: "1", phase: "0" }, ["in", "0"]),
      part("S2", type, { ...square, mode, frequency: "10k", pulsePeriod: "100u", pulseWidth: "50u" }, ["fast", "0"])]);
    // The 1 s trigger forces Δt≈50 µs within 20k points, but a 10 kHz source needs Δt≤100 µs/20=5 µs.
    const plan = steadyStateRun(circuit, { ...settings, end: "500u", step: "100n" });
    assert.match(plan.refused, /한 주기에 20점도 못 그립니다/, `${type} ${mode}`);
    assert.match(plan.refused, /트리거 전원 주기 1 s가 가장 빠른 전원 주기 0.0001 s보다 훨씬 길어.*정상상태를 끄세요/, "no R·C here: the slow trigger source is the cause");
    assert.doesNotMatch(plan.refused, /R·C/);
  }
  // R·C 1k·200µ gives a 2 s bound, but without it the 1 s trigger still forces Δt ≈ 50 µs > 5 µs: the slow trigger is the cause, not R·C.
  const slow = make([part("V1", "V", { ...square, pulsePeriod: "1", pulseWidth: "500m" }, ["in", "0"]), part("R1", "R", { value: "1k" }, ["in", "out"]),
    part("C1", "C", { value: "200u", ic: "0" }, ["out", "0"]), part("V2", "V", { ...square, pulsePeriod: "100u", pulseWidth: "50u" }, ["fast", "0"])]);
  const slowPlan = steadyStateRun(slow, { ...settings, end: "500u", step: "100n" });
  assert.match(slowPlan.refused, /트리거 전원 주기 1 s가 가장 빠른 전원 주기 0.0001 s보다 훨씬 길어.*정상상태를 끄세요/);
  assert.doesNotMatch(slowPlan.refused, /R·C/);
  const circuit = make([part("V1", "V", { mode: "SIN", frequency: "1k", phase: "0" }), part("I1", "I", { mode: "SIN", frequency: "10k", phase: "0" })]);
  const plan = steadyStateRun(circuit, { ...settings, end: "500u", step: "100n" });
  // Trigger 1 ms + window 0.5 ms at 0.1 µs = 15k steps; both source periods have at least 20 samples.
  assert.ok(plan && !plan.refused);
  assert.ok(plan.step <= 100e-6 / 20);
  assert.ok(plan.end / plan.step <= 19990 + 1e-6);
});

test("정상상태: PULSE(5 0 0 100u 100u 300u 1m)는 실제 상승인 1.4 ms에서 트리거한다", () => {
  for (const delay of ["0", "2m"]) {
    const delaySeconds = delay === "0" ? 0 : 2e-3;
    const falling = { ...square, pulseV1: "5", pulseV2: "0", pulseRise: "100u", pulseFall: "100u", pulseWidth: "300u", pulseDelay: delay };
    const circuit = rc("1", "1n", falling);
    const plan = steadyStateRun(circuit, { ...settings, end: "1m", step: "10u" });
    // The source starts 5→0; its 0→5 edge starts at td+tr+pw+kT=td+0.4 ms+1 ms after settling one period.
    near(plan.trigger, delaySeconds + 1.4e-3, 1e-12, "physical rising edge");
    const result = simulate(analysisCircuit(circuit).circuit, { analysis: "transient", start: "0", end: String(plan.trigger + 100e-6), step: "10u" });
    const node = result.topology.nodeIdByPin["V1:0"];
    const at = (time) => result.points[Math.round(time / 10e-6)].nodeVoltages[node];
    near(at(plan.trigger), 0, 1e-9, "rising edge starts at the lower voltage");
    near(at(plan.trigger + 50e-6), 2.5, 1e-8, "halfway through the rising edge");
  }
});

test("정상상태: 주기 전원이 있는 기존 편집기 예제는 실행 간격 보정 후 점 수 상한 안에서 허용된다", () => {
  const periodic = examples.filter(({ circuit }) => circuit.components.some((c) => ["V", "I"].includes(c.type) && ["SIN", "PULSE"].includes(c.props.mode)));
  for (const id of ["rc-charge", "rl", "rlc", "series-resonance", "lowpass-2nd"]) assert.ok(periodic.some((example) => example.id === id), id);
  for (const example of periodic) {
    // The editor defaults to a 5 ms window at 10 µs; analysis-runner refines that step before planning steady state.
    const run = { ...settings, step: "10u", ...example.settings, analysis: "transient" };
    const refined = refinedTransientStep(example.circuit, run);
    if (refined) run.step = String(refined.step);
    const plan = steadyStateRun(example.circuit, run);
    assert.ok(plan && !plan.refused, `${example.id}: ${plan?.refused}`);
    assert.ok(plan.end / plan.step <= 19990 + 1e-6, `${example.id}: point limit`);
  }
});
