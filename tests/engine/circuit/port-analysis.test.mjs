import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { componentDefaults, simulate, simulateACAtFrequency } from "../../../src/circuit-engine.js";
import { analyzeDCPort } from "../../../src/port-analysis.js";
import { cloneExample } from "../../../src/examples.js";
import { executeAnalysisRequest } from "../../../src/analysis-worker.js";

describe("Thevenin and Norton", () => {
  const contract = JSON.parse(readFileSync(new URL("../../fixtures/port-analysis.json", import.meta.url), "utf8"));

  const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });

  const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);

  const source = (id, type, dc, nets) => item(id, type, { ...componentDefaults(type), ref: id, mode: "DC", dc }, nets);

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

  const request = (p, n, externalLoadIds = []) => ({ p, n, externalLoadIds });

  const close = (actual, expected, absolute, relative = contract.tolerances.relative) => assert.ok(Math.abs(actual - expected) <= absolute + relative * Math.abs(expected), `${actual} != ${expected}`);

  function basic() {
    return make([
      source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]), resistor("RL", "4k", ["p", "0"]),
    ]);
  }

  test("basic Thevenin/Norton values, load predictions and reversed port", () => {
    const circuit = basic();
    const original = JSON.stringify(circuit);
    const normal = analyzeDCPort(circuit, request({ componentId: "RL", pin: 0 }, { componentId: "RL", pin: 1 }, ["RL"]));
    close(normal.equivalent.vth.value, contract.basic.vth, contract.tolerances.voltageAbs);
    close(normal.equivalent.rth.value, contract.basic.rth, contract.tolerances.resistanceAbs);
    close(normal.equivalent.in.value, contract.basic.in, contract.tolerances.currentAbs);
    close(normal.trials.current.voltage, contract.basic.trialVoltage, contract.tolerances.voltageAbs);
    close(normal.equivalent.residual, 0, contract.tolerances.voltageAbs + contract.basic.rth * contract.tolerances.currentAbs, 0);
    for (const load of contract.basic.loads) {
      const voltage = normal.equivalent.vth.value * load.resistance / (normal.equivalent.rth.value + load.resistance);
      close(voltage, load.voltage, contract.tolerances.voltageAbs);
      close(voltage / load.resistance, load.current, contract.tolerances.currentAbs);
    }
    const reversed = analyzeDCPort(circuit, request({ componentId: "RL", pin: 1 }, { componentId: "RL", pin: 0 }, ["RL"]));
    close(reversed.equivalent.vth.value, -contract.basic.vth, contract.tolerances.voltageAbs);
    close(reversed.equivalent.rth.value, contract.basic.rth, contract.tolerances.resistanceAbs);
    close(reversed.equivalent.in.value, -contract.basic.in, contract.tolerances.currentAbs);
    assert.equal(JSON.stringify(circuit), original);
  });

  test("dependent sources remain active and negative resistance is retained", () => {
    const active = make([
      resistor("R1", "1k", ["p", "0"]),
      item("G1", "VCCS", { ref: "G1", gm: "-0.5mS" }, ["p", "0", "p", "0"]),
    ]);
    const activeResult = analyzeDCPort(active, request({ componentId: "R1", pin: 0 }, { componentId: "R1", pin: 1 }));
    close(activeResult.equivalent.rth.value, contract.active.rth, contract.tolerances.resistanceAbs);
    close(activeResult.trials.current.voltage, contract.active.trialVoltage, contract.tolerances.voltageAbs);

    const negative = make([
      resistor("R1", "1k", ["p", "0"]),
      item("G1", "VCCS", { ref: "G1", gm: "-2mS" }, ["p", "0", "p", "0"]),
      source("I1", "I", "1m", ["0", "p"]),
    ]);
    const negativeResult = analyzeDCPort(negative, request({ componentId: "R1", pin: 0 }, { componentId: "R1", pin: 1 }));
    close(negativeResult.equivalent.vth.value, contract.negative.vth, contract.tolerances.voltageAbs);
    close(negativeResult.equivalent.rth.value, contract.negative.rth, contract.tolerances.resistanceAbs);
    close(negativeResult.equivalent.in.value, contract.negative.in, contract.tolerances.currentAbs);
  });

  test("zeroed independent V and sensor branches stay available to CCCS", () => {
    for (const targetType of ["V", "CURRENT_SENSOR"]) {
      const target = targetType === "V"
        ? source("V0", "V", "7", ["b", "0"])
        : item("S1", "CURRENT_SENSOR", { ref: "S1" }, ["b", "0"]);
      const targetId = targetType === "V" ? "V0" : "S1";
      const circuit = make([
        resistor("R1", "1k", ["p", "b"]), target,
        item("F1", "CCCS", { ref: "F1", beta: "1" }, ["p", "0"], { kind: "branchCurrent", elementId: targetId, direction: 1 }),
      ]);
      const result = analyzeDCPort(circuit, request({ componentId: "R1", pin: 0 }, { componentId: "F1", pin: 1 }));
      close(result.equivalent.rth.value, contract.branchReference.rth, contract.tolerances.resistanceAbs);
      close(result.trials.current.voltage, contract.branchReference.trialVoltage, contract.tolerances.voltageAbs);
    }
  });

  test("ideal voltage and verified ideal current ports use explicit tagged states", () => {
    const idealVoltage = make([source("V1", "V", "5", ["p", "0"])]);
    const voltage = analyzeDCPort(idealVoltage, request({ componentId: "V1", pin: 0 }, { componentId: "V1", pin: 1 }));
    close(voltage.equivalent.vth.value, contract.idealVoltage.vth, contract.tolerances.voltageAbs);
    assert.equal(voltage.equivalent.rth.kind, contract.idealVoltage.rthKind);
    assert.equal(voltage.equivalent.in.kind, contract.idealVoltage.inKind);
    assert.equal(voltage.trials.short.status, "error");

    const idealCurrent = make([source("I1", "I", "2m", ["0", "p"])]);
    const current = analyzeDCPort(idealCurrent, request({ componentId: "I1", pin: 1 }, { componentId: "I1", pin: 0 }));
    assert.equal(current.classification, "ideal-current");
    assert.equal(current.equivalent.vth.kind, contract.idealCurrent.vthKind);
    assert.equal(current.equivalent.rth.kind, contract.idealCurrent.rthKind);
    close(current.equivalent.in.value, contract.idealCurrent.in, contract.tolerances.currentAbs);
    close(current.trials.clamps.oneVolt.branchCurrent, current.trials.clamps.twoVolt.branchCurrent, contract.tolerances.currentAbs);
  });
});

describe("port boundaries", () => {
  const item = (id, type, props, nets, control) => ({ id, type, x: 100, y: 100, rotation: 0, props, ...(control ? { control } : {}), nets });

  function make(specs) {
    const all = [...specs, item("GND", "GND", { ref: "GND" }, ["0"])], groups = new Map(), wires = [];
    const components = all.map(({ nets, ...component }) => component);
    all.forEach((component) => component.nets.forEach((net, pin) => { if (!groups.has(net)) groups.set(net, []); groups.get(net).push({ componentId: component.id, pin }); }));
    for (const endpoints of groups.values()) for (let i = 1; i < endpoints.length; i += 1) wires.push({ id: `W${wires.length + 1}`, a: endpoints[0], b: endpoints[i] });
    return { version: 3, geometryVersion: 2, components, wires, junctions: [] };
  }

  const resistor = (id, value, nets) => item(id, "R", { ref: id, value }, nets);

  const source = (id, type, dc, nets) => item(id, type, { ...componentDefaults(type), ref: id, dc }, nets);

  const code = (expected) => (error) => error?.code === expected;

  test("rejects same/missing endpoints, nonlinear circuits and invalid load boundaries", () => {
    const circuit = make([source("V1", "V", "5", ["a", "0"]), resistor("R1", "1k", ["a", "p"]), resistor("RL", "1k", ["p", "0"])]);
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 0 }, externalLoadIds: ["RL"] }), code("PORT_SAME_NET"));
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "missing", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: [] }), code("PORT_ENDPOINT_MISSING"));
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: ["R1"] }), code("PORT_LOAD_BOUNDARY"));
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "RL", pin: 0 }, n: { componentId: "RL", pin: 1 }, externalLoadIds: ["absent"] }), code("PORT_LOAD_MISSING"));
    const diode = make([item("D1", "D", { ref: "D1", is: "1e-12", n: "1" }, ["p", "0"])]);
    assert.throws(() => analyzeDCPort(diode, { p: { componentId: "D1", pin: 0 }, n: { componentId: "D1", pin: 1 }, externalLoadIds: [] }), code("PORT_NONLINEAR_UNSUPPORTED"));
  });

  test("rejects removal of a referenced control branch and preserves input on failure", () => {
    const circuit = make([
      item("S1", "CURRENT_SENSOR", { ref: "S1" }, ["p", "0"]),
      item("F1", "CCCS", { ref: "F1", beta: "0" }, ["p", "0"], { kind: "branchCurrent", elementId: "S1", direction: 1 }),
      resistor("R1", "1k", ["p", "0"]),
    ]);
    const before = JSON.stringify(circuit);
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "S1", pin: 0 }, n: { componentId: "S1", pin: 1 }, externalLoadIds: ["S1"] }), code("PORT_LOAD_IS_CONTROL"));
    assert.equal(JSON.stringify(circuit), before);
  });

  test("accepts a multi-component load with only p/n boundary and rejects a third boundary", () => {
    const twoBoundary = make([
      source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
      resistor("RL1", "1k", ["p", "x"]), resistor("RL2", "1k", ["x", "0"]),
    ]);
    const request = { p: { componentId: "RL1", pin: 0 }, n: { componentId: "RL2", pin: 1 }, externalLoadIds: ["RL1", "RL2"] };
    const result = analyzeDCPort(twoBoundary, request);
    assert.ok(Math.abs(result.equivalent.vth.value - 8) < 1e-9);

    const thirdBoundary = make([
      source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
      resistor("KEEP", "9k", ["x", "0"]), resistor("RL1", "1k", ["p", "x"]), resistor("RL2", "1k", ["x", "0"]),
    ]);
    assert.throws(() => analyzeDCPort(thirdBoundary, request), code("PORT_LOAD_BOUNDARY"));
  });

  test("keeps unrelated ideal-branch nonuniqueness explicit", () => {
    const circuit = make([
      source("V1", "V", "12", ["a", "0"]), resistor("R1", "2k", ["a", "p"]), resistor("R2", "4k", ["p", "0"]),
      source("VX1", "V", "0", ["x", "0"]), source("VX2", "V", "0", ["x", "0"]),
    ]);
    assert.throws(() => analyzeDCPort(circuit, { p: { componentId: "R2", pin: 0 }, n: { componentId: "R2", pin: 1 }, externalLoadIds: [] }), code("PORT_RTH_UNRESOLVED"));
  });
});

describe("worker envelope", () => {
  const contract = JSON.parse(readFileSync(new URL("../../fixtures/analysis-worker.json", import.meta.url), "utf8"));

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

  test("Worker DC and transient preserve the complete direct result and input", () => {
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

  test("Worker AC returns one snapshot's sweep and phasor with complex values", () => {
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

  test("Worker port result matches direct calculation and constants", () => {
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

  test("Worker preserves CircuitError fields across structured clone", () => {
    const circuit = { version: 1, components: [resistor("R1", "1k", ["a", "b"])].map(({ nets, ...component }) => component), wires: [], junctions: [] };
    let direct;
    try { simulate(circuit, { analysis: "dc" }); } catch (error) { direct = error; }
    const envelope = crossWorker({ requestId: 5, kind: "normal", payload: { circuit, settings: { analysis: "dc" } } });
    assert.equal(envelope.ok, false);
    assert.deepEqual(envelope.error, {
      name: direct.name, code: direct.code, message: direct.message, hint: direct.hint, details: direct.details,
    });
  });
});
