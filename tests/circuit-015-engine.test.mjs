import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, simulateACAtFrequency, simulateDC, simulateTransient } from "../src/circuit-engine.js";

const contract = JSON.parse(readFileSync(new URL("./fixtures/CIRCUIT-015/contracts.json", import.meta.url), "utf8"));
const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });
const source = (id, props, nets) => item(id, "V", { ...componentDefaults("V"), ref: id, ...props }, nets);
const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);
const sensor = (id, nets) => item(id, "CURRENT_SENSOR", { ref: id }, nets);
const dependent = (type, value, controlId, direction = 1, nets = ["out", "0"]) => item(
  type === "CCCS" ? "F1" : "H1", type,
  type === "CCCS" ? { ref: "F1", beta: String(value) } : { ref: "H1", rm: String(value) },
  nets, { kind: "branchCurrent", elementId: controlId, direction },
);

function make(specs) {
  const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])];
  const components = all.map(({ nets, ...component }) => component);
  const groups = new Map(), wires = [];
  all.forEach((component) => component.nets.forEach((net, pin) => {
    if (!groups.has(net)) groups.set(net, []);
    groups.get(net).push({ componentId: component.id, pin });
  }));
  for (const endpoints of groups.values()) for (let index = 1; index < endpoints.length; index += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[index] });
  return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
}

function base(type, { controlId = "S1", direction = 1, coefficient = type === "CCCS" ? "3" : "2k", sourceProps = { dc: "5" } } = {}) {
  return make([
    source("V1", sourceProps, ["a", "0"]), resistor("R1", "5k", ["a", "b"]), sensor("S1", ["b", "0"]),
    dependent(type, coefficient, controlId, direction), resistor("RL", "1k", ["out", "0"]),
  ]);
}

const node = (result, id, pin = 0) => result.topology.nodeIdByPin[`${id}:${pin}`];
const realVoltage = (result, point, id, pin = 0) => point.nodeVoltages[node(result, id, pin)];
const close = (actual, expected, absolute, relative = 0) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);

test("CIRCUIT-015 DC sensor, CCCS and CCVS satisfy independent signs and KCL", () => {
  for (const [type, expected] of [["CCCS", contract.dc.cccs], ["CCVS", contract.dc.ccvs]]) {
    const result = simulateDC(base(type));
    const point = result.points[0];
    close(point.componentCurrents.S1, contract.dc.sensorCurrent, 1e-11, 1e-8);
    close(realVoltage(result, point, type === "CCCS" ? "F1" : "H1"), expected.outputVoltage, 1e-9, 1e-8);
    close(point.componentCurrents[type === "CCCS" ? "F1" : "H1"], expected.outputCurrent, 1e-11, 1e-8);
    close(point.componentCurrents[type === "CCCS" ? "F1" : "H1"] + point.componentCurrents.RL, 0, 1e-10);
    close(point.componentCurrents.R1 - point.componentCurrents.S1, 0, 1e-12);
  }
});

test("CIRCUIT-015 direct V branch reference and single/double reversals preserve defined signs", () => {
  for (const type of ["CCCS", "CCVS"]) {
    const expected = type === "CCCS" ? contract.dc.cccs.outputVoltage : contract.dc.ccvs.outputVoltage;
    const direct = simulateDC(base(type, { controlId: "V1", direction: -1 })).points[0];
    const directResult = simulateDC(base(type, { controlId: "V1", direction: -1 }));
    close(realVoltage(directResult, directResult.points[0], type === "CCCS" ? "F1" : "H1"), expected, 1e-9, 1e-8);
    const reversed = simulateDC(base(type, { direction: -1 }));
    close(realVoltage(reversed, reversed.points[0], type === "CCCS" ? "F1" : "H1"), -expected, 1e-9, 1e-8);
    assert.ok(Number.isFinite(direct.componentCurrents.V1));
  }
});

test("CIRCUIT-015 AC uses the same instantaneous control branch phasor", () => {
  const phase = contract.ac.phaseDegrees * Math.PI / 180;
  for (const [type, magnitude] of [["CCCS", -3], ["CCVS", 2]]) {
    const circuit = base(type, { sourceProps: { dc: "0", acMagnitude: "5", acPhase: String(contract.ac.phaseDegrees) } });
    const result = simulateACAtFrequency(circuit, contract.ac.frequency), point = result.points[0];
    const value = point.nodeVoltages[node(result, type === "CCCS" ? "F1" : "H1")];
    close(value.re, magnitude * Math.cos(phase), 1e-9, 1e-8);
    close(value.im, magnitude * Math.sin(phase), 1e-9, 1e-8);
    close(point.componentCurrents.S1.re, .001 * Math.cos(phase), 1e-11, 1e-8);
    close(point.componentCurrents.S1.im, .001 * Math.sin(phase), 1e-11, 1e-8);
  }
});

test("CIRCUIT-015 transient has five same-time sensor/dependent samples", () => {
  for (const [type, scale] of [["CCCS", -3], ["CCVS", 2]]) {
    const circuit = base(type, { sourceProps: { mode: "SIN", dc: "0", offset: "0", amplitude: "5", frequency: "1k", phase: "0" } });
    const result = simulateTransient(circuit, { start: "0", end: "1m", step: "250u" });
    assert.equal(result.points.length, contract.transient.samples);
    result.points.forEach((point, index) => {
      const time = result.xValues[index], sine = Math.sin(2 * Math.PI * 1000 * time);
      close(time, index * .00025, 1e-15);
      close(point.componentCurrents.S1, .001 * sine, 1e-11, 1e-8);
      close(realVoltage(result, point, type === "CCCS" ? "F1" : "H1"), scale * sine, 1e-9, 1e-8);
    });
  }
});

test("CIRCUIT-015 mutually controlled CCVS loops solve simultaneously and singular cases fail", () => {
  const mutual = (rm, v1, v2) => make([
    source("V1", { dc: String(v1) }, ["a1", "0"]), resistor("R1", "1k", ["a1", "x1"]),
    item("H1", "CCVS", { ref: "H1", rm: String(rm) }, ["x1", "y1"], { kind: "branchCurrent", elementId: "S2", direction: 1 }), sensor("S1", ["y1", "0"]),
    source("V2", { dc: String(v2) }, ["a2", "0"]), resistor("R2", "1k", ["a2", "x2"]),
    item("H2", "CCVS", { ref: "H2", rm: String(rm) }, ["x2", "y2"], { kind: "branchCurrent", elementId: "S1", direction: 1 }), sensor("S2", ["y2", "0"]),
  ]);
  const solved = simulateDC(mutual("500", 1, 2)), point = solved.points[0];
  close(point.componentCurrents.S1, 0, 1e-11); close(point.componentCurrents.S2, .002, 1e-11, 1e-8);
  close(realVoltage(solved, point, "H1", 0) - realVoltage(solved, point, "H1", 1), 1, 1e-9, 1e-8);
  close(realVoltage(solved, point, "H2", 0) - realVoltage(solved, point, "H2", 1), 0, 1e-9);
  assert.throws(() => simulateDC(mutual("1k", 1, 1)), (error) => error.code === "SINGULAR");
  assert.throws(() => simulateDC(mutual("1k", 1, 2)), (error) => error.code === "SINGULAR");
});
