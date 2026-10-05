import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, simulate, simulateACAtFrequency } from "../src/circuit-engine.js";
import { analyzeDCPort } from "../src/port-analysis.js";
import { cloneExample } from "../src/examples.js";
import { executeAnalysisRequest } from "../src/analysis-worker.js";

const contract = JSON.parse(readFileSync(new URL("./fixtures/CIRCUIT-018/contracts.json", import.meta.url), "utf8"));
const item = (id, type, props, nets) => ({ id, type, x: 100, y: 100, rotation: 0, props, nets });
const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);
const source = (id, props, nets) => item(id, "V", { ...componentDefaults("V"), ref: id, ...props }, nets);

function make(specs) {
  const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])];
  const components = all.map(({ nets, ...component }) => component);
  const groups = new Map();
  const wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => {
    if (!groups.has(net)) groups.set(net, []);
    groups.get(net).push({ componentId: component.id, pin });
  }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) {
    wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  }
  return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
}

function crossWorker(message) {
  return structuredClone(executeAnalysisRequest(structuredClone(message)));
}

function node(result, point, componentId, pin) {
  return point.nodeVoltages[result.topology.nodeIdByPin[`${componentId}:${pin}`]];
}

const close = (actual, expected, absolute, relative = contract.tolerances.relative) => {
  assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);
};
const cclose = (actual, re, im, absolute) => { close(actual.re, re, absolute); close(actual.im, im, absolute); };

test("CIRCUIT-018 Worker DC and transient preserve the complete direct result and input", () => {
  const dcCircuit = make([source("V1", { mode: "DC", dc: "5" }, ["p", "0"]), resistor("R1", "1k", ["p", "0"])]);
  const dcOriginal = structuredClone(dcCircuit);
  const dcDirect = simulate(dcCircuit, { analysis: "dc" });
  const dcEnvelope = crossWorker({ requestId: 1, kind: "normal", payload: { circuit: dcCircuit, settings: { analysis: "dc" } } });
  assert.equal(dcEnvelope.ok, true);
  assert.deepEqual(dcEnvelope.value.result, dcDirect);
  close(node(dcEnvelope.value.result, dcEnvelope.value.result.points[0], "R1", 0), contract.dc.voltage, contract.tolerances.voltageAbs);
  close(dcEnvelope.value.result.points[0].componentCurrents.R1, contract.dc.current, contract.tolerances.currentAbs);
  assert.deepEqual(dcCircuit, dcOriginal);

  const example = cloneExample("rc-charge");
  const settings = { analysis: "transient", ...contract.transient };
  const transientOriginal = structuredClone(example.circuit);
  const direct = simulate(example.circuit, settings);
  const envelope = crossWorker({ requestId: 2, kind: "normal", payload: { circuit: example.circuit, settings } });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.value.result.xValues, direct.xValues);
  assert.deepEqual(envelope.value.result.points, direct.points);
  assert.equal(envelope.value.result.points.length, direct.points.length);
  assert.ok(envelope.value.result.points.every((point) => Object.values(point.nodeVoltages).every(Number.isFinite)));
  assert.deepEqual(example.circuit, transientOriginal);
});

test("CIRCUIT-018 Worker AC returns one snapshot's sweep and phasor with complex values", () => {
  const circuit = make([source("V1", { mode: "SIN", dc: "0", acMagnitude: "1", acPhase: "0" }, ["p", "0"]), resistor("R1", "1k", ["p", "0"])]);
  const settings = { analysis: "ac", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: contract.ac.frequency };
  const direct = simulate(circuit, settings);
  const directPhasor = simulateACAtFrequency(circuit, contract.ac.frequency);
  const envelope = crossWorker({ requestId: 3, kind: "normal", payload: { circuit, settings } });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.value.result, direct);
  assert.deepEqual(envelope.value.phasorResult, directPhasor);
  const point = envelope.value.phasorResult.points[0];
  cclose(node(envelope.value.phasorResult, point, "R1", 0), contract.ac.voltageRe, contract.ac.voltageIm, contract.tolerances.voltageAbs);
  cclose(point.componentCurrents.R1, contract.ac.currentRe, contract.ac.currentIm, contract.tolerances.currentAbs);
});

test("CIRCUIT-018 Worker port result matches direct calculation and constants", () => {
  const circuit = make([
    source("V1", { mode: "DC", dc: "12" }, ["a", "0"]),
    resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]), resistor("RL", "4k", ["p", "0"]),
  ]);
  const request = { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: ["RL"] };
  const direct = analyzeDCPort(circuit, request);
  const envelope = crossWorker({ requestId: 4, kind: "port", payload: { circuit, request } });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.value, direct);
  close(envelope.value.equivalent.vth.value, contract.port.vth, contract.tolerances.voltageAbs);
  close(envelope.value.equivalent.rth.value, contract.port.rth, contract.tolerances.resistanceAbs);
  close(envelope.value.equivalent.in.value, contract.port.in, contract.tolerances.currentAbs);
});

test("CIRCUIT-018 Worker preserves CircuitError fields across structured clone", () => {
  const circuit = { version: 1, components: [resistor("R1", "1k", ["a", "b"])].map(({ nets, ...component }) => component), wires: [], junctions: [] };
  let direct;
  try { simulate(circuit, { analysis: "dc" }); } catch (error) { direct = error; }
  const envelope = crossWorker({ requestId: 5, kind: "normal", payload: { circuit, settings: { analysis: "dc" } } });
  assert.equal(envelope.ok, false);
  assert.deepEqual(envelope.error, {
    name: direct.name, code: direct.code, message: direct.message, hint: direct.hint, details: direct.details,
  });
});
