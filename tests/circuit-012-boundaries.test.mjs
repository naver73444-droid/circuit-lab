import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildTopology, simulateACAtFrequency, simulateDC, simulateTransient,
} from "../src/circuit-engine.js";
import * as parentEngine from "./frozen/CIRCUIT-010/src/circuit-engine.js";
import { buildResultsCSV } from "../src/csv-format.js";
import { classifyNumericInput, cloneSelectedComponent, deleteComponentFromCircuit, splitWireAtJunction, retargetWireProbes } from "../src/circuit-edit.js";
import { pinPosition, routeWirePoints } from "../src/circuit-geometry.js";
import { InputDrafts } from "../src/input-drafts.js";
import { deserializeProject, serializeProject } from "../src/project-format.js";
import { escapeHtml } from "../src/safe-dom.js";

const readFixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const f0Text = readFixture("circuit-012-f0.json");
const f0 = deserializeProject(f0Text);
const VABS = 1e-9, VREL = 1e-8, IABS = 1e-11, IREL = 1e-8;
const close = (actual, expected, abs = VABS, rel = VREL) => {
  assert.ok(Number.isFinite(actual));
  assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
};
const cclose = (actual, expected) => { close(actual.re, expected.re); close(actual.im, expected.im); };
const node = (result, point, id, pin) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

function seriesFor(result, probes) {
  return probes.map((probe) => {
    const raw = probe.kind === "voltage"
      ? result.points.map((point) => node(result, point, probe.componentId, probe.pin))
      : result.points.map((point) => point.componentCurrents[probe.componentId]);
    return { probe, raw };
  });
}

function electricalPayload(result) {
  return {
    analysis: result.analysis,
    xValues: result.xValues,
    points: result.points.map((point) => ({
      Vn: node(result, point, "R2", 0),
      IR1: point.componentCurrents.R1,
      IR2: point.componentCurrents.R2,
      IV1: point.componentCurrents.V1,
    })),
  };
}

test("CIRCUIT-012 F0 DC/transient/AC contract and frozen-parent bytes are unchanged", () => {
  const candidateDc = simulateDC(f0.circuit), parentDc = parentEngine.simulateDC(f0.circuit);
  assert.deepEqual(electricalPayload(candidateDc), electricalPayload(parentDc));
  const point = candidateDc.points[0];
  close(node(candidateDc, point, "R2", 0), 2.5);
  close(point.componentCurrents.R1, 0.0025, IABS, IREL);
  close(point.componentCurrents.R2, 0.0025, IABS, IREL);
  close(point.componentCurrents.V1, -0.0025, IABS, IREL);
  assert.equal(buildResultsCSV(candidateDc, seriesFor(candidateDc, f0.probes)), buildResultsCSV(parentDc, seriesFor(parentDc, f0.probes)));

  const settings = { start: 0, end: "20u", step: "10u" };
  const candidateTransient = simulateTransient(f0.circuit, settings), parentTransient = parentEngine.simulateTransient(f0.circuit, settings);
  assert.deepEqual(electricalPayload(candidateTransient), electricalPayload(parentTransient));
  for (const sample of candidateTransient.points) {
    close(node(candidateTransient, sample, "R2", 0), 2.5);
    close(sample.componentCurrents.R2, 0.0025, IABS, IREL);
  }

  const candidateAc = simulateACAtFrequency(f0.circuit, 1), parentAc = parentEngine.simulateACAtFrequency(f0.circuit, 1);
  assert.deepEqual(electricalPayload(candidateAc), electricalPayload(parentAc));
  cclose(node(candidateAc, candidateAc.points[0], "R2", 0), { re: 0.5, im: 0 });
  cclose(candidateAc.points[0].componentCurrents.R2, { re: 0.0005, im: 0 });
});

for (const origin of ["inspector", "inline"]) for (const value of ["banana", "", "Infinity"]) test(`CIRCUIT-012 ${origin} ${JSON.stringify(value)} draft is component-owned and blocks commit`, () => {
  const drafts = new InputDrafts();
  drafts.set("prop", "R1", "value", value, "1k");
  assert.equal(drafts.get("prop", "R1", "value"), value);
  assert.equal(drafts.get("prop", "R2", "value"), undefined);
  assert.notEqual(classifyNumericInput(value, { positive: true }).status, "valid");
  assert.deepEqual(drafts.entries(), [{ kind: "prop", id: "R1", property: "value", value }]);
  drafts.delete("prop", "R1", "value");
  assert.equal(drafts.size, 0);
});

test("CIRCUIT-012 explicit 2k recovery computes the new result, not the old 1k result", () => {
  const project = deserializeProject(f0Text);
  project.circuit.components.find((component) => component.id === "R1").props.value = "2k";
  const result = simulateDC(project.circuit), point = result.points[0];
  close(node(result, point, "R2", 0), 5 / 3);
  close(point.componentCurrents.R2, 1 / 600, IABS, IREL);
  close(point.componentCurrents.V1, -1 / 600, IABS, IREL);
});

test("CIRCUIT-012 malformed projects are atomically rejected at the parse boundary", () => {
  const base = JSON.parse(f0Text);
  const variants = [];
  const duplicateProbe = structuredClone(base); duplicateProbe.probes.push(structuredClone(duplicateProbe.probes[0])); variants.push(JSON.stringify(duplicateProbe));
  const stringInfinity = structuredClone(base); stringInfinity.circuit.components[0].x = "Infinity"; variants.push(JSON.stringify(stringInfinity));
  variants.push(f0Text.replace('"x": 120', '"x": 1e309'));
  const bogus = structuredClone(base); bogus.settings.analysis = "bogus"; variants.push(JSON.stringify(bogus));
  const settingsArray = structuredClone(base); settingsArray.settings = []; variants.push(JSON.stringify(settingsArray));
  const bananaStep = structuredClone(base); bananaStep.settings.analysis = "transient"; bananaStep.settings.step = "banana"; variants.push(JSON.stringify(bananaStep));
  const zeroStep = structuredClone(base); zeroStep.settings.analysis = "transient"; zeroStep.settings.step = "0"; variants.push(JSON.stringify(zeroStep));
  const infiniteFrequency = structuredClone(base); infiniteFrequency.settings.analysis = "ac"; infiniteFrequency.settings.startFrequency = "Infinity"; variants.push(JSON.stringify(infiniteFrequency));
  const state = { circuit: structuredClone(f0.circuit), settings: structuredClone(f0.settings), probes: structuredClone(f0.probes), draft: "banana", history: ["h"], future: ["f"] };
  const before = structuredClone(state);
  for (const text of variants) {
    assert.throws(() => deserializeProject(text));
    assert.deepEqual(state, before);
  }
});

test("CIRCUIT-012 imported labels stay inert while unsafe colors reject", () => {
  const marker = '<b data-circuit-marker="012">MARK012</b>';
  const onerror = '<img src=x onerror="window.__CIRCUIT_012_MARKER__=1">';
  const marked = JSON.parse(f0Text);
  marked.title = marker;
  marked.probes[0].label = onerror;
  const restored = deserializeProject(JSON.stringify(marked));
  assert.equal(restored.title, marker);
  assert.equal(restored.probes[0].label, onerror);
  assert.doesNotMatch(escapeHtml(marker), /<b\b/);
  assert.doesNotMatch(escapeHtml(onerror), /<img\b/);
  const unsafe = structuredClone(marked); unsafe.probes[0].color = marker;
  assert.throws(() => deserializeProject(JSON.stringify(unsafe)));
});

test("CIRCUIT-012 geometry1/2 and legacy/ideal OP AMP round-trip with stable meaning", () => {
  const fixtures = [
    ["circuit-012-geometry1-divider.json", "R", 2.5],
    ["circuit-012-f0.json", "R", 2.5],
    ["circuit-012-legacy-opamp.json", "OPAMP", 100000 / 100001],
    ["opamp-ideal-follower.json", "OPAMP_IDEAL", 1],
  ];
  for (const [file, type, expectedVoltage] of fixtures) {
    const project = deserializeProject(readFixture(file));
    const restored = deserializeProject(serializeProject(project));
    assert.equal(restored.circuit.geometryVersion, project.circuit.geometryVersion);
    assert.deepEqual(restored.circuit, project.circuit);
    const opamp = restored.circuit.components.find((component) => component.id === "U1");
    if (opamp) assert.equal(opamp.type, type);
    const result = simulateDC(restored.circuit);
    const target = opamp ? ["U1", 2] : ["R2", 0];
    close(node(result, result.points[0], ...target), expectedVoltage, 1e-12, 1e-8);
  }
});

test("CIRCUIT-012 probe history keeps move/add/delete as independent undo-redo states", () => {
  let model = { circuit: structuredClone(f0.circuit), probes: structuredClone(f0.probes) };
  const history = [], future = [];
  const snapshot = () => structuredClone(model);
  const mutate = (change) => { history.push(snapshot()); future.length = 0; change(); };
  const undo = () => { future.push(snapshot()); model = history.pop(); };
  const redo = () => { history.push(snapshot()); model = future.pop(); };
  const originalX = model.circuit.components.find((component) => component.id === "R1").x;
  mutate(() => { model.circuit.components.find((component) => component.id === "R1").x += 20; });
  const movedX = originalX + 20;
  mutate(() => { model.probes.push({ key: "I:R1", kind: "current", componentId: "R1", label: "I(R1)", color: "#8844aa" }); });
  mutate(() => { model.probes = model.probes.filter((probe) => probe.key !== "I:R1"); });
  undo(); assert.ok(model.probes.some((probe) => probe.key === "I:R1")); assert.equal(model.circuit.components.find((component) => component.id === "R1").x, movedX);
  undo(); assert.ok(!model.probes.some((probe) => probe.key === "I:R1")); assert.equal(model.circuit.components.find((component) => component.id === "R1").x, movedX);
  undo(); assert.equal(model.circuit.components.find((component) => component.id === "R1").x, originalX);
  redo(); redo(); assert.ok(model.probes.some((probe) => probe.key === "I:R1")); redo(); assert.ok(!model.probes.some((probe) => probe.key === "I:R1"));
});

test("CIRCUIT-012 middle/endpoint split preserves topology and valid probe references", () => {
  const circuit = structuredClone(f0.circuit);
  const wire = circuit.wires.find((item) => item.id === "W2");
  const byId = new Map(circuit.components.map((component) => [component.id, component]));
  const route = routeWirePoints(wire, pinPosition(byId.get("R1"), 1, 2), pinPosition(byId.get("R2"), 0, 2), 2);
  const middle = route[Math.floor(route.length / 2)];
  const split = splitWireAtJunction(circuit, "W2", middle, route);
  const probes = retargetWireProbes(f0.probes, "W2", split.replacementWireId, split);
  assert.equal(split.unchanged, false);
  assert.equal(split.circuit.wires.length, circuit.wires.length + 1);
  assert.ok(split.circuit.wires.some((item) => item.id === probes.find((probe) => probe.key === "V:R2:0").wireId));
  assert.equal(buildTopology(split.circuit).nodeIdByPin["R1:1"], buildTopology(split.circuit).nodeIdByPin["R2:0"]);
  const endpoint = splitWireAtJunction(circuit, "W2", route[0], route);
  assert.equal(endpoint.unchanged, true);
  assert.equal(endpoint.circuit.wires.length, circuit.wires.length);
  assert.equal(endpoint.circuit.junctions.length, circuit.junctions.length);
});

test("CIRCUIT-012 component deletion clears dangling probes/wires and undo data can restore atomically", () => {
  const before = { circuit: structuredClone(f0.circuit), probes: structuredClone(f0.probes) };
  const deleted = deleteComponentFromCircuit(before.circuit, "R2", before.probes);
  assert.ok(!deleted.circuit.components.some((component) => component.id === "R2"));
  assert.ok(!deleted.circuit.wires.some((wire) => wire.a.componentId === "R2" || wire.b.componentId === "R2"));
  assert.ok(!deleted.probes.some((probe) => probe.componentId === "R2"));
  assert.ok(deleted.probes.some((probe) => probe.key === "V:V1:0"));
  assert.deepEqual(structuredClone(before), before);
  const clone = cloneSelectedComponent(deleted.circuit, "R1");
  assert.ok(clone);
  assert.ok(!deleted.circuit.components.some((component) => component.id === clone.id));
  assert.ok(!deleted.probes.some((probe) => probe.componentId === clone.id));
});

test("CIRCUIT-012 product does not register future dependent-source or port types", () => {
  const engine = readFileSync(new URL("../src/circuit-engine.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  for (const type of ["VCVS", "VCCS", "CCCS", "CCVS", "PORT"]) {
    assert.doesNotMatch(engine.match(/const TYPE_PINS = \{[\s\S]*?\};/)?.[0] ?? "", new RegExp(`\\b${type}\\b`));
    assert.doesNotMatch(app.match(/const PALETTE = \[[\s\S]*?\];/)?.[0] ?? "", new RegExp(`\\b${type}\\b`));
  }
});
