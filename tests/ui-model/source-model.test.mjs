import test from "node:test";
import assert from "node:assert/strict";
import { componentDefaults, parseValue, simulateACAtFrequency, simulateDC } from "../../src/circuit-engine.js";
import { steadyStateRun, suggestAnalysis } from "../../src/analysis-policy.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { analysisCircuit, averageLevel, generatorEdit, generatorFieldText, generatorLabel, generatorView, migrateGeneratorSource, migrateGeneratorSources, siValueText } from "../../src/source-model.js";

const source = (type = "V", props = {}) => ({ id: `${type}1`, type, props: { ...componentDefaults(type), ref: `${type}1`, ...props } });
const apply = (component, key, value) => { const patch = generatorEdit(component, key, value); assert.ok(patch, `${key} = ${value}`); Object.assign(component.props, patch); return component; };
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("siValueText writes values the editor reads back", () => {
  for (const [value, text] of [[1000, "1k"], [1e-3, "1m"], [5e-4, "500u"], [1 / 3000, "333.333u"], [2.5e6, "2.5M"], [0.5, "500m"], [50, "50"], [0, "0"], [-2.5, "-2.5"]]) {
    assert.equal(siValueText(value), text);
    assert.ok(Math.abs(parseValue(text) - value) <= Math.abs(value) * 1e-5, text);
  }
});

test("a new source is DC; 사인 starts as the lab's 5 Vpp 1 kHz cosine and 구형 keeps amplitude, frequency and offset", () => {
  const v = source();
  assert.equal(generatorLabel(v), "DC 5 V");
  apply(v, "wave", "SIN");
  assert.deepEqual(generatorView(v.props), { wave: "SIN", vpp: 5, frequency: 1000, offset: 0, phase: 0 });
  assert.equal(generatorLabel(v), "사인 5 Vpp · 1 kHz");
  apply(v, "vpp", "2"); apply(v, "frequency", "10k"); apply(v, "offset", "1");
  assert.equal(v.props.amplitude, "1", "stored as the engine's peak");
  apply(v, "wave", "SQUARE");
  const square = generatorView(v.props);
  assert.deepEqual([square.vpp, square.frequency, square.offset, square.duty, square.low, square.high], [2, 10000, 1, 50, 0, 2]);
  assert.equal(generatorLabel(v), "구형 2 Vpp · 10 kHz · +1 V");
  apply(v, "wave", "SIN");
  assert.deepEqual(generatorView(v.props), { wave: "SIN", vpp: 2, frequency: 10000, offset: 1, phase: 0 }, "back to the same sine");
  apply(v, "wave", "DC");
  assert.equal(generatorLabel(v), "DC 5 V", "DC keeps its own level");
  apply(v, "wave", "SIN");
  assert.equal(generatorLabel(v), "사인 2 Vpp · 10 kHz · +1 V", "a sine set before comes back");
  const i = apply(source("I"), "wave", "SQUARE");
  assert.equal(generatorLabel(i), "구형 2 mApp · 1 kHz");
});

test("lab sheet: a 0–5 V, 1 kHz square wave is 5 Vpp, offset 2.5 V; duty and edges change only the width; bad values are refused", () => {
  const v = apply(apply(apply(source(), "wave", "SQUARE"), "vpp", "5"), "offset", "2.5");
  assert.deepEqual([v.props.pulseV1, v.props.pulseV2, v.props.pulsePeriod, v.props.pulseWidth], ["0", "5", "1m", "500u"]);
  assert.equal(generatorFieldText(v.props, "frequency"), "1k");
  apply(v, "duty", "20");
  assert.equal(v.props.pulseWidth, "200u");
  near(averageLevel(v.props), 1, 1e-12, "average of a 20 % 0–5 V square");
  apply(v, "rise", "10u"); apply(v, "fall", "10u");
  near(averageLevel(v.props), 0 + 5 * (200e-6 + 10e-6) / 1e-3, 1e-12, "edges add half their time at the high level");
  for (const [key, value] of [["duty", "0"], ["duty", "100"], ["frequency", "0"], ["vpp", "-1"], ["rise", "900u"], ["frequency", "abc"], ["level", "1"]]) {
    assert.equal(generatorEdit(v, key, value), null, `${key} ${value}`);
  }
  const sine = apply(source(), "wave", "SIN");
  apply(sine, "phase", "30");
  assert.equal(sine.props.phase, "120", "the engine's SIN phase is sin-based: cos 30° = sin 120°");
  assert.equal(generatorFieldText(sine.props, "phase"), "30");
});

test("a run reads DC as the waveform's average and AC as the sine's peak∠phase; with no sine the first source is the 1 V input", () => {
  const sine = apply(apply(apply(source(), "wave", "SIN"), "vpp", "4"), "phase", "30");
  Object.assign(sine.props, { offset: "1", dc: "7", acMagnitude: "9", acPhase: "45" });
  const square = apply(apply(source("V", { ref: "V2" }), "wave", "SQUARE"), "offset", "2.5");
  square.id = "V2";
  const dc = source("V", { ref: "V3", dc: "12", acMagnitude: "1" });
  dc.id = "V3";
  let { circuit, acInput } = analysisCircuit({ components: [sine, square, dc] });
  const props = Object.fromEntries(circuit.components.map((c) => [c.id, c.props]));
  assert.equal(acInput, null);
  assert.deepEqual([props.V1.dc, props.V1.acMagnitude, props.V1.acPhase], ["1", "2", "30"], "stored DC 7 / AC 9∠45° are not used");
  assert.deepEqual([Number(props.V2.dc), props.V2.acMagnitude], [2.5, "0"]);
  assert.deepEqual([props.V3.dc, props.V3.acMagnitude], ["12", "0"]);
  assert.equal(sine.props.dc, "7", "the input circuit is not changed");
  ({ circuit, acInput } = analysisCircuit({ components: [square, dc] }));
  assert.equal(acInput, "V2");
  assert.deepEqual(circuit.components.map((c) => c.props.acMagnitude), ["1", "0"]);
});

test("the AC and DC answers of a lab RC follow the generator: 5 Vpp 1 kHz sine with 1 V offset into 1.5 kΩ · 47 nF", () => {
  const part = (id, type, props, nets) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets });
  const all = [part("V1", "V", {}, ["in", "0"]), part("R1", "R", { value: "1.5k" }, ["in", "out"]), part("C1", "C", { value: "47n" }, ["out", "0"]), part("G1", "GND", {}, ["0"])];
  apply(all[0], "wave", "SIN"); apply(all[0], "offset", "1");
  const groups = new Map(), wires = [];
  all.forEach((c) => c.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: c.id, pin }); }));
  for (const ends of groups.values()) for (let k = 1; k < ends.length; k += 1) wires.push({ id: `W${wires.length + 1}`, a: ends[0], b: ends[k] });
  const circuit = analysisCircuit({ version: 3, geometryVersion: 2, components: all.map(({ nets, ...c }) => c), wires, junctions: [] }).circuit;
  const out = (result) => result.points[0].nodeVoltages[result.nodeIdByPin?.["C1:0"] ?? 2];
  near(out(simulateDC(circuit)), 1, 1e-9, "DC: the capacitor is open, V(out) = offset");
  const v = out(simulateACAtFrequency(circuit, "1k"));
  const wRC = 2 * Math.PI * 1e3 * 1.5e3 * 47e-9;
  near(Math.hypot(v.re, v.im), 2.5 / Math.hypot(1, wRC), 1e-9, "|V(out)| = Vpk/√(1+(ωRC)²)");
  near(Math.atan2(v.im, v.re) * 180 / Math.PI, -Math.atan(wRC) * 180 / Math.PI, 1e-6, "cos phase 0 at the input: the output lags by atan(ωRC)");
});

test("files from before: in a file saved for AC, the separate AC values move into the waveform; DC/transient files keep their waveforms", () => {
  const ac = { analysis: "ac", frequency: "159.155" };
  const defaultSine = migrateGeneratorSource(source("V", { mode: "SIN", acMagnitude: "1", acPhase: "0" }), ac);
  assert.deepEqual([defaultSine.props.amplitude, defaultSine.props.phase], ["1", "90"], "AC 1∠0° on a default 5 V sine: the AC answer stays 1∠0°");
  const dcWithAc = migrateGeneratorSource(source("V", { mode: "DC", dc: "3", acMagnitude: "10", acPhase: "30" }), ac);
  assert.deepEqual([dcWithAc.props.mode, dcWithAc.props.offset, dcWithAc.props.amplitude, dcWithAc.props.phase, dcWithAc.props.frequency], ["SIN", "3", "10", "120", "159.155"]);
  const current = migrateGeneratorSource(source("I", { mode: "DC", dc: "0" }), ac);
  assert.equal(current.props.amplitude, "1m", "an I source keeps its 1 mA AC (not 1 A)");
  const off = migrateGeneratorSource(source("V", { mode: "DC", acMagnitude: "0" }), ac);
  assert.equal(off.props.mode, "DC", "AC 0 alone stays a DC source (only the file-level rule may make it a silent sine)");
  const linear = migrateGeneratorSource(source("V", { mode: "SIN", dc: "5", offset: "0", acMagnitude: "1", acPhase: "0" }), ac);
  assert.equal(linear.props.offset, "0", "without a diode the hidden DC value (5 V) is not moved into the offset");
  assert.equal(generatorLabel(linear), "사인 2 Vpp · 60 Hz","the label keeps no +5 V");
  const matching = migrateGeneratorSource(source("V", { mode: "SIN", amplitude: "2", phase: "0", acMagnitude: "2", acPhase: "-90" }), ac);
  assert.deepEqual([matching.props.amplitude, matching.props.phase], ["2", "0"], "a sine that already gives its AC value is kept");
  const transient = migrateGeneratorSource(source("V", { mode: "SIN", acMagnitude: "2" }), { analysis: "transient" });
  assert.deepEqual([transient.props.amplitude, transient.props.phase], ["5", "0"], "a transient file keeps its 5 V sine");
  // Two sources with their own AC parts give the same AC answer before and after.
  const part = (id, type, props, nets) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets });
  const all = [part("V1", "V", { mode: "DC", acMagnitude: "10", acPhase: "30" }, ["a", "0"]), part("V2", "V", { mode: "DC", acMagnitude: "5", acPhase: "-45" }, ["b", "0"]),
    part("R1", "R", { value: "1k" }, ["a", "m"]), part("R2", "R", { value: "2k" }, ["b", "m"]), part("R3", "R", { value: "3k" }, ["m", "0"]), part("G", "GND", {}, ["0"])];
  const groups = new Map(), wires = [];
  all.forEach((c) => c.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: c.id, pin }); }));
  for (const ends of groups.values()) for (let k = 1; k < ends.length; k += 1) wires.push({ id: `W${wires.length + 1}`, a: ends[0], b: ends[k] });
  const circuit = { version: 3, geometryVersion: 2, components: all.map(({ nets, ...c }) => c), wires, junctions: [] };
  const before = simulateACAtFrequency(circuit, "1k").points[0].componentCurrents.R3;
  const migrated = structuredClone(circuit);
  migrated.components.forEach((c) => migrateGeneratorSource(c, ac));
  const after = simulateACAtFrequency(analysisCircuit(migrated).circuit, "1k").points[0].componentCurrents.R3;
  near(after.re, before.re, 1e-12, "Re I(R3)"); near(after.im, before.im, 1e-12, "Im I(R3)");
});

function migrationCircuit(props, diode = false) {
  const part = (id, type, props, nets) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets });
  const all = [part("V1", "V", props, ["in", "0"]), part("R1", "R", { value: "1k" }, ["in", diode ? "out" : "0"]), part("G1", "GND", {}, ["0"])];
  if (diode) all.push(part("D1", "D", { is: "1e-12", n: "1" }, ["out", "0"]));
  const groups = new Map(), wires = [];
  all.forEach((c) => c.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: c.id, pin }); }));
  for (const ends of groups.values()) for (let k = 1; k < ends.length; k += 1) wires.push({ id: `W${wires.length + 1}`, a: ends[0], b: ends[k] });
  return { version: 3, geometryVersion: 2, components: all.map(({ nets, ...c }) => c), wires, junctions: [] };
}
const voltageAt = (result, pin) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[pin]];

test("옛 AC 이전: dc=5, offset=0인 SIN의 다이오드 동작점과 AC 5.807 mV를 보존한다", () => {
  for (const [amplitude, phase] of [["1", "90"], ["8", "45"]]) {
    const before = migrationCircuit({ mode: "SIN", dc: "5", offset: "0", amplitude, phase, acMagnitude: "1", acPhase: "0" }, true);
    const dcBefore = simulateDC(before), acBefore = simulateACAtFrequency(before, "1k");
    const migrated = structuredClone(before);
    const notes = migrateGeneratorSources(migrated.components, { analysis: "ac", frequency: "1k" });
    assert.equal(migrated.components[0].props.offset, "5", "the old engine reads dc for the AC operating point, even when offset is present");
    assert.deepEqual(notes, ["V1: DC 값 5 V를 사인 오프셋으로 옮김"], "the status line says the offset moved");
    const prepared = analysisCircuit(migrated);
    assert.equal(prepared.circuit.components[0].props.dc, "5");
    const dcAfter = simulateDC(prepared.circuit), acAfter = simulateACAtFrequency(prepared.circuit, "1k");
    // DC: V(in)=5 V, I≈(5−0.574)/1k; rd≈25.85m/I=5.841 Ω, so |Vo|≈rd/(1k+rd)=5.807 mV.
    near(voltageAt(dcAfter, "V1:0"), 5, 1e-9, "source operating point");
    near(voltageAt(dcAfter, "D1:0"), voltageAt(dcBefore, "D1:0"), 1e-9, "diode operating point");
    const oldOut = voltageAt(acBefore, "D1:0"), newOut = voltageAt(acAfter, "D1:0");
    near(Math.hypot(newOut.re, newOut.im), 5.807e-3, 1e-6, "biased diode small-signal output");
    near(newOut.re, oldOut.re, 1e-10, "AC real part");
    near(newOut.im, oldOut.im, 1e-10, "AC imaginary part");
  }
});

test("옛 AC 이전: DC/PULSE의 명시적 AC=0은 무입력을 유지하고 DC 평균도 보존한다", () => {
  for (const mode of ["DC", "PULSE"]) {
    const circuit = migrationCircuit({ mode, dc: "5", acMagnitude: "0", acPhase: "30" });
    migrateGeneratorSources(circuit.components, { analysis: "ac", frequency: "2k" });
    const prepared = analysisCircuit(circuit);
    assert.equal(circuit.components[0].props.mode, "SIN");
    assert.equal(circuit.components[0].props.frequency, "2k");
    assert.equal(prepared.acInput, null);
    assert.equal(prepared.circuit.components[0].props.acMagnitude, "0");
    // A silent AC source drives a 1 kΩ load with 0 V; its DC operating point remains 5 V.
    near(voltageAt(simulateDC(prepared.circuit), "R1:0"), 5, 1e-9, "DC level");
    const v = voltageAt(simulateACAtFrequency(prepared.circuit, "2k"), "R1:0");
    near(Math.hypot(v.re, v.im), 0, 1e-12, "AC load voltage");
  }
  const current = source("I", { dc: "2m", acMagnitude: "0" });
  migrateGeneratorSources([current], { analysis: "ac" });
  assert.deepEqual([current.props.mode, current.props.offset, current.props.amplitude], ["SIN", "2m", "0"]);
});

test("옛 AC 이전: acMagnitude가 없는 파일은 기존 1 입력 대체를 유지한다", () => {
  const circuit = migrationCircuit({ mode: "DC", dc: "5" });
  delete circuit.components[0].props.acMagnitude;
  migrateGeneratorSources(circuit.components, { analysis: "ac" });
  const prepared = analysisCircuit(circuit);
  assert.equal(circuit.components[0].props.mode, "DC");
  assert.equal(prepared.acInput, "V1");
  // With no legacy AC field the existing fallback is 1 V, hence 1 mA through 1 kΩ.
  const v = voltageAt(simulateACAtFrequency(prepared.circuit, "1k"), "R1:0");
  near(Math.hypot(v.re, v.im), 1, 1e-12, "fallback input");
});

/** An old (pre-generator) circuit from [id, type, props, nets] rows, wired by net name. */
function oldCircuit(rows) {
  const all = [...rows.map(([id, type, props, nets]) => ({ id, type, x: 100, y: 100, rotation: 0, props: { ...componentDefaults(type), ref: id, ...props }, nets })),
    { id: "G1", type: "GND", x: 100, y: 100, rotation: 0, props: { ref: "GND" }, nets: ["0"] }];
  const groups = new Map(), wires = [];
  all.forEach((c) => c.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: c.id, pin }); }));
  for (const ends of groups.values()) for (let k = 1; k < ends.length; k += 1) wires.push({ id: `W${wires.length + 1}`, a: ends[0], b: ends[k] });
  return { version: 3, geometryVersion: 2, components: all.map(({ nets, ...c }) => c), wires, junctions: [] };
}
const oldSettings = { analysis: "ac", start: "0", end: "5m", step: "10u", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "20", phasorFrequency: "1k" };
/** The file an old version saved: serializeProject's JSON without the generator marker. */
function openOld(circuit, settings) {
  const payload = JSON.parse(serializeProject({ title: "옛 파일", circuit, settings, probes: [] }));
  delete payload.sources;
  return deserializeProject(JSON.stringify(payload), settings);
}

test("옛 AC 이전: 다른 사인이 있으면 AC 0인 DC·PULSE는 그대로 두고, 트리거·자동 해석 추천에도 끼지 않는다", () => {
  const rows = [["V1", "V", { mode: "DC", dc: "12", acMagnitude: "0" }, ["a", "0"]], ["R1", "R", { value: "1k" }, ["a", "0"]],
    ["V3", "V", { mode: "PULSE", pulseV1: "0", pulseV2: "5", pulseWidth: "1m", pulsePeriod: "2m", acMagnitude: "0" }, ["c", "0"]], ["R3", "R", { value: "1k" }, ["c", "0"]],
    ["V2", "V", { mode: "SIN", frequency: "50", amplitude: "1", phase: "90", acMagnitude: "1", acPhase: "0" }, ["b", "0"]], ["R2", "R", { value: "1k" }, ["b", "m"]], ["C1", "C", { value: "1u" }, ["m", "0"]]];
  const circuit = oldCircuit(rows);
  const before = simulateACAtFrequency(circuit, "159.155").points[0].componentCurrents.R2;
  const notes = migrateGeneratorSources(circuit.components, { analysis: "ac", frequency: "159.155" });
  const props = (id) => circuit.components.find((c) => c.id === id).props;
  assert.deepEqual(notes, []);
  assert.equal(props("V1").mode, "DC", "the DC supply stays DC (no '사인 0 Vpp · +12 V')");
  assert.equal(props("V3").mode, "PULSE", "the clock keeps its square");
  assert.equal(generatorLabel(circuit.components[0]), "DC 12 V");
  const prepared = analysisCircuit(circuit);
  assert.equal(prepared.acInput, null, "the sine is the input; V1 and V3 get AC 0 as in the file");
  const after = simulateACAtFrequency(prepared.circuit, "159.155").points[0].componentCurrents.R2;
  near(after.re, before.re, 1e-12, "Re I(R2)"); near(after.im, before.im, 1e-12, "Im I(R2)");
  const plan = steadyStateRun(circuit, { analysis: "transient", start: "0", end: "100m", step: "20u" });
  assert.equal(plan.source, "V3", "the first periodic source triggers");
  // A file with only the DC supply: no sine is left, so V1 becomes the silent 0 Vpp sine — and is still not a time source.
  const lone = oldCircuit(rows.slice(0, 2));
  migrateGeneratorSources(lone.components, { analysis: "ac", frequency: "159.155" });
  assert.deepEqual([lone.components[0].props.mode, lone.components[0].props.amplitude, lone.components[0].props.offset], ["SIN", "0", "12"]);
  assert.equal(analysisCircuit(lone).acInput, null, "the file's AC 0 is kept (no 1 V input)");
  assert.equal(suggestAnalysis(lone, oldSettings, "auto").settings.analysis, "dc", "a 0 Vpp sine is a DC level for the automatic choice");
  assert.equal(steadyStateRun(lone, { analysis: "transient", start: "0", end: "5m", step: "10u" }), null, "nothing to trigger on");
  // Only one silent source turns into a sine, a DC one before a square, so the square keeps its waveform.
  const both = oldCircuit(rows.slice(2, 4).concat(rows.slice(0, 2)));
  migrateGeneratorSources(both.components, { analysis: "ac" });
  assert.deepEqual(both.components.filter((c) => c.type === "V").map((c) => c.props.mode), ["PULSE", "SIN"]);
});

test("옛 AC 파일 열기(deserializeProject): 다이오드 회로의 SIN dc=5는 DC 5 V·|Vout| 5.807 mV를 지키고 상태줄에 알린다", () => {
  const circuit = oldCircuit([["V1", "V", { mode: "SIN", dc: "5", offset: "0", amplitude: "1", phase: "90", acMagnitude: "1", acPhase: "0" }, ["in", "0"]],
    ["R1", "R", { value: "1k" }, ["in", "out"]], ["D1", "D", { is: "1e-12", n: "1" }, ["out", "0"]]]);
  const project = openOld(circuit, oldSettings);
  assert.deepEqual(project.notes, ["V1: DC 값 5 V를 사인 오프셋으로 옮김"]);
  const prepared = analysisCircuit(project.circuit).circuit;
  near(voltageAt(simulateDC(prepared), "V1:0"), 5, 1e-9, "DC V(in)");
  const out = voltageAt(simulateACAtFrequency(prepared, "1k"), "D1:0");
  near(Math.hypot(out.re, out.im), 5.807e-3, 1e-6, "|Vout|");
  // A file already in the generator model is read as it is.
  const fresh = deserializeProject(serializeProject({ circuit: project.circuit, settings: oldSettings, probes: [] }), oldSettings);
  assert.deepEqual(fresh.notes, []);
});

test("옛 DC 파일 열기: SIN의 DC 값은 오프셋으로 옮겨 DC 답을 지키고, 평균이 다른 구형은 그대로 두고 알린다", () => {
  const dc = { ...oldSettings, analysis: "dc" };
  const circuit = oldCircuit([["V1", "V", { mode: "SIN", dc: "5", offset: "0", amplitude: "1", acMagnitude: "1" }, ["in", "0"]],
    ["R1", "R", { value: "1k" }, ["in", "out"]], ["D1", "D", { is: "1e-12", n: "1" }, ["out", "0"]],
    ["V2", "V", { mode: "PULSE", dc: "5", pulseV1: "0", pulseV2: "5", pulseWidth: "1m", pulsePeriod: "4m" }, ["p", "0"]], ["R2", "R", { value: "1k" }, ["p", "0"]]]);
  const before = simulateDC(circuit);
  const project = openOld(circuit, dc);
  assert.deepEqual(project.notes, ["V1: DC 값 5 V를 사인 오프셋으로 옮김", "V2: 구형의 DC 해석 값이 예전 DC 값 5 V가 아닌 파형 평균 1.25 V입니다"]);
  const v1 = project.circuit.components.find((c) => c.id === "V1").props, v2 = project.circuit.components.find((c) => c.id === "V2").props;
  assert.deepEqual([v1.mode, v1.offset, v1.amplitude], ["SIN", "5", "1"], "the sine keeps its waveform around the old DC value");
  assert.equal(v2.mode, "PULSE", "the square stays a square");
  const after = simulateDC(analysisCircuit(project.circuit).circuit);
  near(voltageAt(after, "V1:0"), 5, 1e-9, "V(in) as the old simulateDC");
  near(voltageAt(after, "D1:0"), voltageAt(before, "D1:0"), 1e-9, "diode operating point");
  // A sine whose dc already equals its offset, or a transient file, moves nothing.
  const same = oldCircuit([["V1", "V", { mode: "SIN", dc: "2", offset: "2" }, ["a", "0"]], ["R1", "R", { value: "1k" }, ["a", "0"]]]);
  assert.deepEqual(migrateGeneratorSources(same.components, { analysis: "dc" }), []);
  const transient = oldCircuit([["V1", "V", { mode: "SIN", dc: "5", offset: "0" }, ["a", "0"]], ["R1", "R", { value: "1k" }, ["a", "0"]]]);
  migrateGeneratorSources(transient.components, { analysis: "transient" });
  assert.equal(transient.components[0].props.offset, "0");
});
