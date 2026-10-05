import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  componentDefaults, deserializeCircuit, pinCount, serializeCircuit,
  simulateACAtFrequency, simulateDC, simulateTransient,
} from "../src/circuit-engine.js";
import { localPin } from "../src/circuit-geometry.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";
import { buildResultsCSV, parseCSV } from "../src/csv-format.js";

const VABS = 1e-9, VREL = 1e-8, IABS = 1e-11, IREL = 1e-8;
const close = (actual, expected, abs = VABS, rel = VREL) => assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
const cclose = (actual, expected, abs = VABS, rel = VREL) => { close(actual.re, expected.re, abs, rel); close(actual.im, expected.im, abs, rel); };

function makeCircuit(definition) {
  const components = definition.map(item => ({ id: item.id, type: item.type, props: { ref: item.id, ...item.props } }));
  components.push({ id: "G1", type: "GND", props: { ref: "GND" } });
  const nets = new Map([["0", [{ componentId: "G1", pin: 0 }]]]);
  for (const item of definition) item.nets.forEach((net, pin) => {
    if (!nets.has(net)) nets.set(net, []);
    nets.get(net).push({ componentId: item.id, pin });
  });
  const junctions = [...nets].map(([net], index) => ({ id: `J${index}`, x: index * 20, y: 0 }));
  const junctionByNet = new Map([...nets.keys()].map((net, index) => [net, junctions[index].id]));
  const wires = [];
  for (const [net, endpoints] of nets) for (const endpoint of endpoints) wires.push({ id: `W${wires.length + 1}`, a: endpoint, b: { junctionId: junctionByNet.get(net) } });
  return { version: 1, geometryVersion: 2, components, wires, junctions };
}

const voltage = (id, dc = 0, acMagnitude = 0, acPhase = 0, amplitude = 0) => ({
  id, type: "V", props: { mode: amplitude ? "SIN" : "DC", dc: String(dc), offset: "0", amplitude: String(amplitude), frequency: "1k", phase: "0", acMagnitude: String(acMagnitude), acPhase: String(acPhase) },
});
const resistor = (id, value) => ({ id, type: "R", props: { value: String(value) } });
const ideal = { id: "U1", type: "OPAMP_IDEAL", props: {} };

function follower({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000, legacy = false } = {}) {
  return makeCircuit([
    { ...voltage("V1", dc, ac, phase, amplitude), nets: ["in", "0"] },
    { ...ideal, type: legacy ? "OPAMP" : "OPAMP_IDEAL", props: legacy ? { gain: "100k" } : {}, nets: ["in", "out", "out"] },
    { ...resistor("RL", load), nets: ["out", "0"] },
  ]);
}
function inverting({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000 } = {}) {
  return makeCircuit([
    { ...voltage("V1", dc, ac, phase, amplitude), nets: ["vin", "0"] },
    { ...resistor("RIN", 10000), nets: ["vin", "sum"] },
    { ...resistor("RF", 20000), nets: ["out", "sum"] },
    { ...ideal, nets: ["0", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
  ]);
}
function noninverting({ dc = 1, ac = 0, phase = 0, amplitude = 0, load = 1000 } = {}) {
  return makeCircuit([
    { ...voltage("V1", dc, ac, phase, amplitude), nets: ["in", "0"] },
    { ...resistor("RG", 10000), nets: ["sum", "0"] }, { ...resistor("RF", 20000), nets: ["out", "sum"] },
    { ...ideal, nets: ["in", "sum", "out"] }, { ...resistor("RL", load), nets: ["out", "0"] },
  ]);
}
function summing({ transient = false } = {}) {
  return makeCircuit([
    { ...voltage("V1", transient ? 0 : 1, transient ? 0 : 1, 0, transient ? 1 : 0), nets: ["v1", "0"] },
    { ...voltage("V2", transient ? 0 : 2, transient ? 2 : 2, transient ? 0 : 90, transient ? 2 : 0), nets: ["v2", "0"] },
    { ...resistor("R1", 10000), nets: ["v1", "sum"] }, { ...resistor("R2", 20000), nets: ["v2", "sum"] },
    { ...resistor("RF", 10000), nets: ["out", "sum"] }, { ...ideal, nets: ["0", "sum", "out"] },
    { ...resistor("RL", 1000), nets: ["out", "0"] },
  ]);
}
const node = (result, id, pin = 0) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];
const pointNode = (result, point, id, pin = 0) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

test("CIRCUIT-010 type, defaults and geometry are explicit without gain", () => {
  assert.equal(pinCount("OPAMP_IDEAL"), 3);
  assert.deepEqual(componentDefaults("OPAMP_IDEAL", 2), { ref: "U2" });
  assert.deepEqual(localPin("OPAMP_IDEAL", 0), { x: -40, y: -20 });
  assert.deepEqual(localPin("OPAMP_IDEAL", 1), { x: -40, y: 20 });
  assert.deepEqual(localPin("OPAMP_IDEAL", 2), { x: 40, y: 0 });
});

for (const [name, circuit, expectedV, expectedI] of [
  ["follower", follower(), 1, -0.001], ["inverting", inverting(), -2, 0.0021],
  ["noninverting", noninverting(), 3, -0.0031], ["summing", summing(), -2, 0.0022],
]) test(`CIRCUIT-010 DC ${name}: ideal constraint, branch sign and output KCL`, () => {
  const result = simulateDC(circuit), output = node(result, "U1", 2), plus = node(result, "U1", 0), minus = node(result, "U1", 1);
  close(output, expectedV); close(plus, minus); close(result.points[0].componentCurrents.U1, expectedI, IABS, IREL);
  const outgoing = circuit.components.filter(c => c.type === "R").reduce((sum, c) => {
    const n0 = node(result, c.id, 0), n1 = node(result, c.id, 1);
    if (Math.abs(n0 - output) <= VABS) return sum + result.points[0].componentCurrents[c.id];
    if (Math.abs(n1 - output) <= VABS) return sum - result.points[0].componentCurrents[c.id];
    return sum;
  }, 0);
  close(outgoing + result.points[0].componentCurrents.U1, 0, 1e-10, 1e-8);
});

test("CIRCUIT-010 load change preserves follower voltage and recomputes branch current", () => {
  const result = simulateDC(follower({ load: 2000 }));
  close(node(result, "U1", 2), 1); close(result.points[0].componentCurrents.U1, -0.0005, IABS, IREL);
  const high = simulateDC(follower({ dc: 10 })); close(node(high, "U1", 2), 10); close(high.points[0].componentCurrents.U1, -0.01, IABS, IREL);
});

test("CIRCUIT-010 ideal input pins draw zero current", () => {
  const circuit = makeCircuit([
    { ...voltage("V1", 1), nets: ["vin", "0"] }, { ...resistor("RIN", 10000), nets: ["vin", "plus"] },
    { ...ideal, nets: ["plus", "out", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
  ]);
  const result = simulateDC(circuit);
  close(node(result, "U1", 0), 1); close(result.points[0].componentCurrents.RIN, 0, 1e-12, 0);
});

for (const frequency of [10, 1000, 100000]) for (const [name, circuit, gain] of [
  ["follower", follower({ dc: 0, ac: 1, phase: 30 }), 1],
  ["inverting", inverting({ dc: 0, ac: 1, phase: 30 }), -2],
  ["noninverting", noninverting({ dc: 0, ac: 1, phase: 30 }), 3],
]) test(`CIRCUIT-010 AC ${name} ${frequency} Hz is frequency-independent ideal gain`, () => {
  const result = simulateACAtFrequency(circuit, frequency);
  const input = node(result, "V1", 0), output = node(result, "U1", 2);
  cclose(output, { re: input.re * gain, im: input.im * gain });
  cclose(node(result, "U1", 0), node(result, "U1", 1));
});

test("CIRCUIT-010 AC summing produces -1-j1 V", () => {
  const result = simulateACAtFrequency(summing(), 1000);
  cclose(node(result, "U1", 2), { re: -1, im: -1 });
});

for (const step of ["10u", "5u"]) for (const [name, circuit, factor] of [
  ["follower", follower({ dc: 0, amplitude: 1 }), t => Math.sin(2 * Math.PI * 1000 * t)],
  ["inverting", inverting({ dc: 0, amplitude: 1 }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
  ["noninverting", noninverting({ dc: 0, amplitude: 1 }), t => 3 * Math.sin(2 * Math.PI * 1000 * t)],
  ["summing", summing({ transient: true }), t => -2 * Math.sin(2 * Math.PI * 1000 * t)],
]) test(`CIRCUIT-010 transient ${name} ${step}: no delay, settling or clipping`, () => {
  const result = simulateTransient(circuit, { start: "0", end: "2m", step });
  result.points.forEach((point, index) => close(pointNode(result, point, "U1", 2), factor(result.xValues[index])));
});

test("CIRCUIT-010 contradictory and non-unique ideal circuits fail explicitly", () => {
  const contradiction = makeCircuit([
    { ...voltage("VP", 1), nets: ["plus", "0"] }, { ...voltage("VM", 0), nets: ["minus", "0"] },
    { ...ideal, nets: ["plus", "minus", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
  ]);
  assert.throws(() => simulateDC(contradiction), error => error.code === "SINGULAR" || error.code === "IDEAL_CONSTRAINT_CONFLICT");
  const nonUnique = makeCircuit([{ ...ideal, nets: ["0", "0", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] }]);
  assert.throws(() => simulateDC(nonUnique), error => error.code === "SINGULAR");
});

test("CIRCUIT-010 positive feedback may have an algebraic solution but is not labelled stable", () => {
  const circuit = makeCircuit([
    { ...voltage("V1", 1), nets: ["vin", "0"] }, { ...resistor("RIN", 10000), nets: ["vin", "out"] },
    { ...ideal, nets: ["out", "0", "out"] }, { ...resistor("RL", 1000), nets: ["out", "0"] },
  ]);
  close(node(simulateDC(circuit), "U1", 2), 0);
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /안정성을 판정하지 않습니다/);
  assert.doesNotMatch(source, /안정(?:함|적|성 확인|성 보장)/);
});

test("CIRCUIT-010 legacy finite-gain follower remains distinct", () => {
  const result = simulateDC(follower({ legacy: true }));
  close(node(result, "U1", 2), 100000 / 100001, 1e-12, 1e-10);
  assert.notEqual(node(result, "U1", 2), 1);
  assert.equal(result.topology.nodeIdByPin["U1:1"], result.topology.nodeIdByPin["U1:2"]);
});

test("CIRCUIT-010 JSON and CSV preserve explicit type, probe color and SI branch sign", () => {
  const circuit = follower();
  const probes = [{ kind: "current", componentId: "U1", key: "I:U1", label: "I(U1, 출력→내부 기준 GND)", color: "#80bfff" }];
  const text = serializeProject({ title: "ideal", subtitle: "MNA", circuit, settings: { analysis: "dc", phasorFrequency: "1000" }, probes });
  const restored = deserializeProject(text);
  assert.equal(restored.circuit.components.find(c => c.id === "U1").type, "OPAMP_IDEAL");
  assert.equal(restored.circuit.components.find(c => c.id === "U1").props.gain, undefined);
  assert.deepEqual(restored.probes, probes);
  assert.equal(deserializeCircuit(serializeCircuit(circuit)).components.find(c => c.id === "U1").type, "OPAMP_IDEAL");
  const result = simulateDC(restored.circuit), raw = result.points.map(point => point.componentCurrents.U1);
  assert.deepEqual(parseCSV(buildResultsCSV(result, [{ probe: probes[0], raw }])), [["operating_point", "I(U1, 출력→내부 기준 GND)_A"], ["0", "-0.001"]]);
});

test("CIRCUIT-010 actual-UI fixture is loadable and numerically exact", () => {
  const project = deserializeProject(readFileSync(new URL("./fixtures/opamp-ideal-follower.json", import.meta.url), "utf8"));
  const result = simulateDC(project.circuit);
  close(node(result, "U1", 2), 1);
  close(result.points[0].componentCurrents.U1, -0.001, IABS, IREL);
  assert.equal(project.probes.length, 2);
});

test("CIRCUIT-010 actual-UI contradiction fixture fails without a stale result", () => {
  const project = deserializeProject(readFileSync(new URL("./fixtures/opamp-ideal-contradiction.json", import.meta.url), "utf8"));
  assert.throws(() => simulateDC(project.circuit), error => error.code === "SINGULAR" || error.code === "IDEAL_CONSTRAINT_CONFLICT");
});

test("CIRCUIT-010 UI distinguishes both models and does not expose a real-model implementation", () => {
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /OPAMP_IDEAL[^\n]+이상 OP AMP/);
  assert.match(source, /출력→내부 기준 GND/);
  assert.match(source, /안정성을 판정하지 않습니다/);
  assert.doesNotMatch(source + html, /OPAMP_REAL_EDU/);
});
